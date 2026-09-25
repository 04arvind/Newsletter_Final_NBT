/**
 * Pipeline stages 12-13: email service / ESP -> all subscribers.
 *
 *     Email Service / ESP
 *            |
 *      All Subscribers
 *
 * Delivery is deliberately split from assembly. Sending to a large list is the
 * one stage that reliably dies half-way — a timeout, a rate limit, a cron
 * window that closes — and rebuilding the issue to retry would pick a different
 * set of articles. So the issue is already stored and frozen before the first
 * email goes out.
 *
 * `newsletter_recipients` is the ledger that makes the send resumable:
 * `queueRecipients` writes one row per subscriber with a derived `_id`, so a
 * re-run queues nobody twice, and `claimQueuedRecipients` returns only the rows
 * still waiting. A run that dies at subscriber 40,000 resumes at 40,001 instead
 * of mailing the first 40,000 again.
 */

import { getDeliveryProvider, type DeliveryProvider } from '../delivery/provider';
import { activeSubscribers, type Recipient } from '../delivery/recipients';
import {
  claimQueuedRecipients,
  countRecipientsByStatus,
  findIssue,
  markRecipientSent,
  queueRecipients,
  updateIssueStatus,
} from '../db/newsletter';
import type { DeliveryStatus } from '../db/types';
import { personalizeIssueHtml } from '../email/personalize';

/** Rows claimed from the ledger per round trip. */
const CLAIM_SIZE = 500;
/** Emails in flight at once. Keeps a large list under the ESP's rate limit. */
const SEND_CONCURRENCY = 25;

export interface DeliverResult {
  issueId: string;
  queued: number;
  sent: number;
  failed: number;
  counts: Record<DeliveryStatus, number>;
  /** True when the run stopped early because `maxToSend` was reached. */
  partial: boolean;
}

export interface DeliverOptions {
  issueId: string;
  baseUrl: string;
  /** Cap for one invocation, so a cron run can stay inside its time budget. */
  maxToSend?: number;
  /**
   * Who to queue. Defaults to every active subscriber — pass a list to send to
   * a resolved audience instead, e.g. the `NEWSLETTER_TO` test inbox while no
   * subscriber exists yet (see `src/lib/delivery/recipients.ts`).
   */
  recipients?: Recipient[];
  /** Transport. Defaults to the configured provider; see `src/lib/delivery/provider.ts`. */
  provider?: DeliveryProvider;
}

/**
 * Queue every active subscriber for an issue and send whatever is still queued.
 *
 * Safe to call repeatedly: queueing is idempotent, an already-sent row is never
 * reset to `queued`, and each call picks up where the last one stopped.
 */
export async function deliverIssue(options: DeliverOptions): Promise<DeliverResult> {
  const issue = await findIssue(options.issueId);
  if (!issue) throw new Error(`Issue ${options.issueId} not found`);
  if (!issue.htmlContent) throw new Error(`Issue ${options.issueId} has no HTML to send`);
  if (issue.status === 'sent') {
    return {
      issueId: issue._id,
      queued: 0,
      sent: 0,
      failed: 0,
      counts: await countRecipientsByStatus(issue._id),
      partial: false,
    };
  }

  // --- queue the audience --------------------------------------------------
  const audience = options.recipients ?? (await activeSubscribers());
  const queued = await queueRecipients(issue._id, audience);

  await updateIssueStatus(issue._id, 'sending');

  // --- send ----------------------------------------------------------------
  const subject = issue.subject || `NBT न्यूजलेटर — ${issue.date}`;
  const provider = options.provider ?? getDeliveryProvider();
  const limit = options.maxToSend ?? Number.POSITIVE_INFINITY;
  let sent = 0;
  let failed = 0;
  let partial = false;

  while (sent + failed < limit) {
    const batch = await claimQueuedRecipients(issue._id, CLAIM_SIZE);
    if (batch.length === 0) break;

    for (let index = 0; index < batch.length; index += SEND_CONCURRENCY) {
      if (sent + failed >= limit) {
        partial = true;
        break;
      }

      const chunk = batch.slice(index, index + SEND_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (recipient) => {
          // The stored HTML is never edited beyond its `{{tokens}}` — the mail
          // that goes out is the snapshot on file plus this reader's address.
          const html = personalizeIssueHtml(issue.htmlContent!, {
            email: recipient.email,
            baseUrl: options.baseUrl,
          });
          try {
            const response = await provider.sendOne({ to: recipient.email, subject, html });
            return {
              recipientId: recipient._id,
              status: 'sent' as DeliveryStatus,
              providerMessageId: response?.id,
            };
          } catch (error) {
            return {
              recipientId: recipient._id,
              status: 'failed' as DeliveryStatus,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      // Written one at a time on purpose: `markRecipientSent` also moves the
      // issue's counters, so the ledger and the summary stay in step even if
      // the process dies in the middle of this loop.
      for (const result of results) {
        await markRecipientSent(result.recipientId, {
          status: result.status,
          providerMessageId: result.providerMessageId,
          error: result.error,
        });
        if (result.status === 'sent') sent += 1;
        else failed += 1;
      }
    }

    if (partial) break;
  }

  // Nothing left queued does not by itself mean the issue went out: if every
  // row failed, the queue is just as empty as after a clean run. An issue no
  // subscriber received must not be recorded as `sent`, or a retry would be
  // refused and the failure would look like a delivery.
  const counts = await countRecipientsByStatus(issue._id);
  if (counts.queued === 0) {
    const delivered = counts.sent + counts.delivered > 0;
    await updateIssueStatus(issue._id, delivered || counts.failed === 0 ? 'sent' : 'failed');
  }

  return {
    issueId: issue._id,
    queued,
    sent,
    failed,
    counts,
    partial: partial || counts.queued > 0,
  };
}
