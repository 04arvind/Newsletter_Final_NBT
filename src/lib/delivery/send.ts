/**
 * Stage 2 of delivery: mail the stored snapshot.
 *
 *     newsletter_issues.htmlContent   (already sealed — never re-rendered here)
 *              |
 *     resolve audience                 subscribers, else NEWSLETTER_TO
 *              |
 *     newsletter_recipients            one row per (issue, address) = the ledger
 *              |
 *     provider.sendOne                 Resend today, see ./provider
 *
 * The send loop itself is `deliverIssue` in `src/lib/pipeline/deliver.ts` and
 * is not reimplemented: it already queues idempotently, claims in batches,
 * resumes a half-finished run and moves the counters on the issue. This module
 * is the part that is specific to *this* entry point — checking the issue is
 * fit to send, deciding who it goes to, and making sure a run where every mail
 * failed ends up marked `failed` rather than `sent`.
 */

import {
  findIssue,
  findIssueByDate,
  issueDateFor,
  requeueFailedRecipients,
  updateIssueStatus,
} from '../db/newsletter';
import type { DeliveryStatus, NewsletterIssueDoc } from '../db/types';
import { getNewsletterWindow } from '../newsletter-window';
import { deliverIssue } from '../pipeline/deliver';
import { DeliveryError, errorMessage } from './errors';
import { assertProviderConfigured, getDeliveryProvider } from './provider';
import { resolveAudience, type RecipientSource } from './recipients';

export interface SendOptions {
  /** Absolute origin of this app — `getInternalAppBaseUrl(request)`. */
  baseUrl: string;
  /** Exact issue id. Takes precedence over `date`. */
  issueId?: string;
  /** `YYYY-MM-DD`. Defaults to the current editorial window's issue. */
  date?: string;
  /** Cap for one invocation, so a local test can send to one address only. */
  maxToSend?: number;
  /**
   * Put this issue's previously failed recipients back in the queue first —
   * for retrying a send that failed on configuration rather than on content.
   */
  retryFailed?: boolean;
}

export interface SendResult {
  issueId: string;
  date: string;
  status: NewsletterIssueDoc['status'];
  provider: string;
  audience: { source: RecipientSource; count: number };
  queued: number;
  sent: number;
  failed: number;
  counts: Record<DeliveryStatus, number>;
  /** True when the run stopped early because `maxToSend` was reached. */
  partial: boolean;
  /** True when the issue had already been sent and this call was a no-op. */
  alreadySent: boolean;
  /** Failed rows returned to the queue by `retryFailed`. */
  requeued: number;
}

/**
 * The issue status implied by its ledger. Mirrors the rule `deliverIssue`
 * applies when it writes the status, so the response cannot disagree with the
 * document.
 */
function statusFromCounts(
  counts: Record<DeliveryStatus, number>
): NewsletterIssueDoc['status'] {
  if (counts.queued > 0) return 'sending';
  if (counts.sent + counts.delivered > 0 || counts.failed === 0) return 'sent';
  return 'failed';
}

/** By id, by date, or today's — in that order. */
export async function findIssueFor(
  options: Pick<SendOptions, 'issueId' | 'date'>
): Promise<NewsletterIssueDoc | null> {
  if (options.issueId) return findIssue(options.issueId);
  const date = options.date || issueDateFor(getNewsletterWindow().windowEnd);
  return findIssueByDate(date);
}

export async function sendIssue(options: SendOptions): Promise<SendResult> {
  // Refuse before anything is queued or the issue is moved to `sending`.
  assertProviderConfigured();

  const issue = await findIssueFor(options);
  if (!issue) {
    throw new DeliveryError(
      'ISSUE_NOT_FOUND',
      'No issue to send — generate one first (POST /api/newsletter/issue/generate)',
      { issueId: options.issueId, date: options.date }
    );
  }
  if (!issue.htmlContent) {
    throw new DeliveryError(
      'ISSUE_NOT_RENDERED',
      `Issue ${issue._id} carries no HTML snapshot`,
      { issueId: issue._id, status: issue.status }
    );
  }

  const provider = getDeliveryProvider();
  const audience = await resolveAudience();

  let requeued = 0;
  if (options.retryFailed && issue.status !== 'sent') {
    requeued = await requeueFailedRecipients(issue._id);
    if (requeued > 0) {
      console.info(`[delivery] ${issue._id} re-queued ${requeued} failed recipient(s)`);
    }
  }

  if (issue.status === 'sent') {
    console.info(`[delivery] ${issue._id} already sent — nothing to do`);
  } else {
    console.info(
      `[delivery] ${issue._id} -> ${audience.recipients.length} recipient(s) ` +
        `from ${audience.source} via ${provider.name}`
    );
  }

  let result;
  try {
    result = await deliverIssue({
      issueId: issue._id,
      baseUrl: options.baseUrl,
      maxToSend: options.maxToSend,
      recipients: audience.recipients,
      provider,
    });
  } catch (error) {
    // The run itself broke — a dead database, a provider that never answered.
    // Individual send failures do not land here; they are recorded per row.
    await updateIssueStatus(issue._id, 'failed').catch(() => {});
    console.error(`[delivery] ${issue._id} failed: ${errorMessage(error)}`);
    throw new DeliveryError(
      'PROVIDER_UNAVAILABLE',
      `Delivery failed for ${issue._id}: ${errorMessage(error)}`,
      { issueId: issue._id }
    );
  }

  // The status `deliverIssue` just settled on, derived from the ledger totals
  // rather than this run's tally — a resumed send that mailed nobody new is
  // still `sent` if earlier invocations delivered.
  const status: NewsletterIssueDoc['status'] = statusFromCounts(result.counts);

  console.info(
    `[delivery] ${issue._id} status=${status} sent=${result.sent} ` +
      `failed=${result.failed} queued=${result.counts.queued}`
  );

  return {
    issueId: issue._id,
    date: issue.date,
    status,
    provider: provider.name,
    audience: { source: audience.source, count: audience.recipients.length },
    queued: result.queued,
    sent: result.sent,
    failed: result.failed,
    counts: result.counts,
    partial: result.partial,
    alreadySent: issue.status === 'sent',
    requeued,
  };
}
