/**
 * The issue, who received it, and what they did with it.
 *
 * - `newsletter_issues` — one document per edition. The content is identical
 *   for every subscriber, so it is stored once and referenced, never copied
 *   per recipient.
 * - `newsletter_recipients` — one row per (issue, subscriber). This doubles as
 *   the send ledger; see `queueRecipients`.
 * - `newsletter_events` — post-send engagement, which feeds click-through rates
 *   back into the next run's scoring.
 */

import { createHash } from 'crypto';
import type { AnyBulkWriteOperation, Collection } from 'mongodb';
import { getDb } from '../mongodb';
import { ensureDbIndexes } from './client';
import type {
  DeliveryStatus,
  IssueSlot,
  IssueStatus,
  NewsletterEventDoc,
  NewsletterEventType,
  NewsletterIssueDoc,
  NewsletterRecipientDoc,
  SlotId,
} from './types';

export const ISSUES_COLLECTION = 'newsletter_issues';
export const RECIPIENTS_COLLECTION = 'newsletter_recipients';
export const EVENTS_COLLECTION = 'newsletter_events';

export async function getNewsletterIssuesCollection(): Promise<Collection<NewsletterIssueDoc>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<NewsletterIssueDoc>(ISSUES_COLLECTION);
}

export async function getRecipientsCollection(): Promise<Collection<NewsletterRecipientDoc>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<NewsletterRecipientDoc>(RECIPIENTS_COLLECTION);
}

export async function getNewsletterEventsCollection(): Promise<Collection<NewsletterEventDoc>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<NewsletterEventDoc>(EVENTS_COLLECTION);
}

/** `2026-09-16` -> `newsletter_2026_09_16`. Derived, so re-running a day's build overwrites rather than duplicates. */
export function deriveIssueId(date: string): string {
  return `newsletter_${date.replace(/-/g, '_')}`;
}

/** One Generate HTML click's own version of a day's issue: `newsletter_2026_09_16_<windowEnd ms>`. */
export function deriveIssueVersionId(date: string, windowEnd: Date): string {
  return `${deriveIssueId(date)}_${windowEnd.getTime()}`;
}

/** Calendar date of an issue in the publishing timezone, as `YYYY-MM-DD`. */
export function issueDateFor(windowEnd: Date, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(windowEnd);
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface SaveIssueInput {
  /** Explicit document id. Defaults to the date-derived id. */
  id?: string;
  date: string;
  windowStart: Date;
  windowEnd: Date;
  topStory: IssueSlot | null;
  slots: Partial<Record<SlotId, IssueSlot>>;
  last24Hours?: IssueSlot[];
  podcast?: NewsletterIssueDoc['podcast'];
  hook?: NewsletterIssueDoc['hook'];
  htmlContent?: string;
  subject?: string;
  categoriesUsed?: string[];
  status?: IssueStatus;
  /** sha1 of `htmlContent`; written together with `sealedAt`. */
  contentHash?: string;
  /** When the HTML snapshot was sealed. Omitted for a build that carries no HTML. */
  sealedAt?: Date;
}

/**
 * Create or refresh the day's issue.
 *
 * The delivery counters are `$setOnInsert` only: rebuilding an issue must not
 * reset `sentCount` back to zero while a send is in flight, or the ledger and
 * the counter would disagree about who has already been mailed.
 */
export async function saveIssue(input: SaveIssueInput): Promise<NewsletterIssueDoc> {
  const id = input.id || deriveIssueId(input.date);
  const now = new Date();
  const collection = await getNewsletterIssuesCollection();

  await collection.updateOne(
    { _id: id },
    {
      $set: {
        date: input.date,
        status: input.status || 'ready',
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        topStory: input.topStory,
        slots: input.slots,
        last24Hours: input.last24Hours || [],
        podcast: input.podcast ?? null,
        hook: input.hook ?? null,
        htmlContent: input.htmlContent,
        subject: input.subject,
        contentHash: input.contentHash,
        sealedAt: input.sealedAt,
        categoriesUsed: input.categoriesUsed || [],
        generatedAt: now,
      },
      $setOnInsert: { recipientCount: 0, sentCount: 0, failedCount: 0 },
    },
    { upsert: true }
  );

  const saved = await collection.findOne({ _id: id });
  if (!saved) throw new Error(`Issue ${id} vanished immediately after upsert`);
  return saved;
}

export async function findIssue(issueId: string): Promise<NewsletterIssueDoc | null> {
  const collection = await getNewsletterIssuesCollection();
  return collection.findOne({ _id: issueId });
}

export async function findIssueByDate(date: string): Promise<NewsletterIssueDoc | null> {
  return findIssue(deriveIssueId(date));
}

/** The most recently generated issue, of any version — for one date when given. */
export async function findLatestIssue(date?: string): Promise<NewsletterIssueDoc | null> {
  const collection = await getNewsletterIssuesCollection();
  return collection.findOne(date ? { date } : {}, { sort: { generatedAt: -1 } });
}

export async function updateIssueStatus(
  issueId: string,
  status: IssueStatus
): Promise<void> {
  const collection = await getNewsletterIssuesCollection();
  await collection.updateOne(
    { _id: issueId },
    { $set: { status, ...(status === 'sent' ? { sentAt: new Date() } : {}) } }
  );
}

/** Every article id used in an issue — the input to `markArticlesUsed`. */
export function articleIdsInIssue(issue: NewsletterIssueDoc): string[] {
  const slots = [
    issue.topStory,
    ...Object.values(issue.slots),
    ...issue.last24Hours,
  ];
  return [
    ...new Set(
      slots
        .map((slot) => slot?.articleId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
}

// ---------------------------------------------------------------------------
// Recipients — the send ledger
// ---------------------------------------------------------------------------

function recipientId(newsletterId: string, email: string): string {
  const hash = createHash('sha1')
    .update(`${newsletterId}|${email.toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);
  return `delivery_${hash}`;
}

/**
 * Queue a batch of subscribers for an issue.
 *
 * The derived `_id` makes this idempotent: queueing the same subscriber twice
 * is a no-op, so the queueing pass can be retried or resumed safely. Crucially
 * the update only `$setOnInsert`s the status — re-queueing must never flip an
 * already-sent row back to `queued` and cause a second email.
 *
 * At 100k subscribers, call this in chunks (10k is comfortable) rather than
 * building one array of 100k operations.
 */
export async function queueRecipients(
  newsletterId: string,
  subscribers: Array<{ email: string; userId?: string }>
): Promise<number> {
  if (subscribers.length === 0) return 0;

  const now = new Date();
  const operations: AnyBulkWriteOperation<NewsletterRecipientDoc>[] = [];
  const seen = new Set<string>();

  for (const subscriber of subscribers) {
    const email = subscriber.email.trim().toLowerCase();
    if (!email) continue;
    const id = recipientId(newsletterId, email);
    if (seen.has(id)) continue;
    seen.add(id);

    operations.push({
      updateOne: {
        filter: { _id: id },
        update: {
          $setOnInsert: {
            newsletterId,
            userId: subscriber.userId,
            email,
            status: 'queued' as DeliveryStatus,
            attempts: 0,
            queuedAt: now,
          },
        },
        upsert: true,
      },
    });
  }

  const collection = await getRecipientsCollection();
  const result = await collection.bulkWrite(operations, { ordered: false });

  if (result.upsertedCount > 0) {
    const issues = await getNewsletterIssuesCollection();
    await issues.updateOne(
      { _id: newsletterId },
      { $inc: { recipientCount: result.upsertedCount } }
    );
  }

  return result.upsertedCount;
}

/**
 * The next slice of subscribers still waiting on this issue.
 *
 * This is what makes a 100k send resumable: a run that dies at subscriber
 * 40,000 leaves the remaining 60,000 rows as `queued`, and the next invocation
 * picks up exactly there instead of re-mailing everyone from the top.
 */
export async function claimQueuedRecipients(
  newsletterId: string,
  limit = 500
): Promise<NewsletterRecipientDoc[]> {
  const collection = await getRecipientsCollection();
  return collection
    .find({ newsletterId, status: 'queued' })
    .sort({ queuedAt: 1 })
    .limit(limit)
    .toArray();
}

/**
 * Record the outcome of one send attempt.
 *
 * Counters move on the issue in the same call so the issue document stays a
 * truthful summary without an aggregation over 100k recipient rows.
 */
export async function markRecipientSent(
  recipientId: string,
  result: { status: DeliveryStatus; providerMessageId?: string; error?: string }
): Promise<void> {
  const collection = await getRecipientsCollection();
  const updated = await collection.findOneAndUpdate(
    { _id: recipientId },
    {
      $set: {
        status: result.status,
        providerMessageId: result.providerMessageId,
        error: result.error,
        sentAt: new Date(),
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: 'after' }
  );

  if (!updated) return;

  const issues = await getNewsletterIssuesCollection();
  const succeeded = result.status === 'sent' || result.status === 'delivered';
  await issues.updateOne(
    { _id: updated.newsletterId },
    { $inc: succeeded ? { sentCount: 1 } : { failedCount: 1 } }
  );
}

/**
 * Put this issue's failed rows back in the queue.
 *
 * A failed row is terminal on purpose — `claimQueuedRecipients` must never pick
 * it up again on its own, or a provider outage would mail everyone twice once
 * it cleared. Re-queueing is therefore an explicit act, for when the cause was
 * a configuration problem (an unverified sender, an expired key) that has since
 * been fixed and the mail genuinely never arrived.
 *
 * The issue's `failedCount` is wound back by the same number, so the counters
 * keep matching the ledger.
 */
export async function requeueFailedRecipients(newsletterId: string): Promise<number> {
  const collection = await getRecipientsCollection();
  const result = await collection.updateMany(
    { newsletterId, status: 'failed' },
    { $set: { status: 'queued' as DeliveryStatus }, $unset: { error: '' } }
  );

  if (result.modifiedCount > 0) {
    const issues = await getNewsletterIssuesCollection();
    await issues.updateOne(
      { _id: newsletterId },
      { $inc: { failedCount: -result.modifiedCount } }
    );
  }

  return result.modifiedCount;
}

export async function countRecipientsByStatus(
  newsletterId: string
): Promise<Record<DeliveryStatus, number>> {
  const collection = await getRecipientsCollection();
  const rows = await collection
    .aggregate<{ _id: DeliveryStatus; count: number }>([
      { $match: { newsletterId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    .toArray();

  const counts: Record<DeliveryStatus, number> = {
    queued: 0,
    sent: 0,
    delivered: 0,
    bounced: 0,
    failed: 0,
  };
  for (const row of rows) counts[row._id] = row.count;
  return counts;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface NewsletterEventInput {
  newsletterId: string;
  email: string;
  event: NewsletterEventType;
  userId?: string;
  articleId?: string;
  slot?: NewsletterEventDoc['slot'];
  url?: string;
  timestamp?: Date;
}

/**
 * Record an engagement event.
 *
 * `opened` and `delivered` are deduplicated per (issue, subscriber, event) —
 * mail clients re-fetch the tracking pixel and would otherwise report one
 * reader as a dozen opens. Clicks keep every occurrence, since which story was
 * clicked, and how often, is the signal we want.
 */
export async function recordNewsletterEvent(
  input: NewsletterEventInput
): Promise<void> {
  const timestamp = input.timestamp || new Date();
  const email = input.email.trim().toLowerCase();
  const deduplicated = input.event === 'opened' || input.event === 'delivered';

  const key = deduplicated
    ? `${input.newsletterId}|${email}|${input.event}`
    : `${input.newsletterId}|${email}|${input.event}|${input.articleId || ''}|${timestamp.toISOString()}`;
  const id = `event_${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;

  const collection = await getNewsletterEventsCollection();
  await collection.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        newsletterId: input.newsletterId,
        userId: input.userId,
        email,
        event: input.event,
        articleId: input.articleId,
        slot: input.slot,
        url: input.url,
        timestamp,
      },
    },
    { upsert: true }
  );
}

export interface SlotPerformance {
  slot: string;
  articleId?: string;
  clicks: number;
  uniqueClickers: number;
}

/**
 * Clicks per slot for one issue.
 *
 * This is the feedback loop: slots that consistently underperform are the ones
 * whose scoring weights need revisiting, and per-article click counts are what
 * eventually populate `historicalCtr` on future articles.
 */
export async function getSlotPerformance(
  newsletterId: string
): Promise<SlotPerformance[]> {
  const collection = await getNewsletterEventsCollection();
  return collection
    .aggregate<SlotPerformance>([
      { $match: { newsletterId, event: 'clicked' } },
      {
        $group: {
          _id: { slot: '$slot', articleId: '$articleId' },
          clicks: { $sum: 1 },
          clickers: { $addToSet: '$email' },
        },
      },
      {
        $project: {
          _id: 0,
          slot: { $ifNull: ['$_id.slot', 'unknown'] },
          articleId: '$_id.articleId',
          clicks: 1,
          uniqueClickers: { $size: '$clickers' },
        },
      },
      { $sort: { clicks: -1 } },
    ])
    .toArray();
}
