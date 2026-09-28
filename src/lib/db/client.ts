/**
 * MongoDB-backed data access for subscribers and newsletter issues.
 *
 * Replaces the old Prisma client. Connection/pooling is handled by
 * `src/lib/mongodb.ts` — do not construct a MongoClient here, otherwise dev HMR
 * would open a second pool alongside the cached one.
 */

import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../mongodb';
import type {
  ArticleDoc,
  ExternalTrendDoc,
  NewsletterEventDoc,
  NewsletterIssueDoc,
  NewsletterRecipientDoc,
  TopicDoc,
  TrendFeatureDoc,
  UpcomingEventDoc,
} from './types';

export type SubscriberStatus = 'active' | 'unsubscribed';

export interface Subscriber {
  _id?: ObjectId;
  email: string;
  status: SubscriberStatus;
  subscribedAt: Date;
  unsubscribedAt: Date | null;
  /** Set by the one-click email unsubscribe link; excluded from every send. */
  unsubscribed?: boolean;
  /** Every newsletter category this address has subscribed to on the site.
   *  One row per address: picking a second newsletter adds to this list rather
   *  than replacing the subscriber. Absent on rows created before categories
   *  existed, and on the one-click email links. */
  categories?: string[];
}

export interface Issue {
  _id?: ObjectId;
  htmlContent: string;
  topTrend: string | null;
  sentCount: number;
  sentAt: Date;
}

let indexesReady: Promise<void> | null = null;

/** Idempotent, lazy — createIndex is a no-op once the index exists. */
export function ensureDbIndexes(): Promise<void> {
  if (!indexesReady) {
    const pending = (async () => {
      const db = await getDb();
      await db.collection<Subscriber>('subscribers').createIndex({ email: 1 }, { unique: true });
      await db.collection<Issue>('issues').createIndex({ sentAt: -1 });

      // --- articles -------------------------------------------------------
      // The article_id is the `_id` (`article_<msid>`), so MongoDB already
      // indexes it uniquely and no explicit index is declared for it here.
      //
      // The compound `{ eligibleSlots, publishedAt }` index is what turns slot
      // filling into a bounded query: filling slot 2 reads only the utility
      // stories in the window instead of scanning the whole pool. Its
      // `{ eligibleSlots, trendScore }` sibling backs the same query when the
      // caller ranks by heat instead of freshness.
      const articles = db.collection<ArticleDoc>('articles');
      await articles.createIndex({ canonicalUrl: 1 }, { unique: true });
      await articles.createIndex({ publishedAt: -1 });
      await articles.createIndex({ eligibleSlots: 1, publishedAt: -1 });
      await articles.createIndex({ eligibleSlots: 1, trendScore: -1 });
      await articles.createIndex({ category: 1, publishedAt: -1 });
      await articles.createIndex({ topicId: 1, publishedAt: -1 });
      // `topic` is the human-readable name the trend collections are keyed on,
      // so a topic looked up from a trend row reaches its articles directly.
      // Sparse: articles ingested before topic grouping runs have none.
      await articles.createIndex({ topic: 1, publishedAt: -1 }, { sparse: true });
      await articles.createIndex({ trendScore: -1 }, { sparse: true });
      await articles.createIndex({ ingestedAt: -1 });
      await articles.createIndex({ lastUsedAt: -1 }, { sparse: true });

      const topics = db.collection<TopicDoc>('topics');
      await topics.createIndex({ category: 1, lastArticleAt: -1 });
      await topics.createIndex({ aliases: 1 });
      await topics.createIndex({ updatedAt: -1 });

      // --- trends ---------------------------------------------------------
      // Both trend collections are append-only samples with no value once the
      // window they describe has passed, so they expire themselves rather than
      // growing without bound.
      const externalTrends = db.collection<ExternalTrendDoc>('external_trends');
      await externalTrends.createIndex({ topic: 1, timestamp: -1 });
      await externalTrends.createIndex({ source: 1, timestamp: -1 });
      await externalTrends.createIndex(
        { timestamp: 1 },
        { expireAfterSeconds: 30 * 24 * 60 * 60 }
      );

      const trendFeatures = db.collection<TrendFeatureDoc>('trend_features');
      await trendFeatures.createIndex({ topic: 1, calculatedAt: -1 });
      await trendFeatures.createIndex({ calculatedAt: -1, trendScore: -1 });
      await trendFeatures.createIndex({ status: 1, calculatedAt: -1 });
      await trendFeatures.createIndex(
        { calculatedAt: 1 },
        { expireAfterSeconds: 90 * 24 * 60 * 60 }
      );

      // --- events ---------------------------------------------------------
      const upcomingEvents = db.collection<UpcomingEventDoc>('upcoming_events');
      await upcomingEvents.createIndex({ eligibleSlot: 1, eventDate: 1 });
      await upcomingEvents.createIndex({ eventDate: 1 });

      // --- newsletter -----------------------------------------------------
      const newsletterIssues = db.collection<NewsletterIssueDoc>('newsletter_issues');
      await newsletterIssues.createIndex({ date: -1 });
      await newsletterIssues.createIndex({ status: 1, generatedAt: -1 });

      // `{ newsletterId, email }` unique is the guard that stops a retried or
      // resumed send from mailing the same subscriber twice; `{ newsletterId,
      // status }` is what the resume query pages through.
      const recipients = db.collection<NewsletterRecipientDoc>('newsletter_recipients');
      await recipients.createIndex({ newsletterId: 1, email: 1 }, { unique: true });
      await recipients.createIndex({ newsletterId: 1, status: 1, queuedAt: 1 });
      await recipients.createIndex({ email: 1, queuedAt: -1 });
      // Sparse on both event collections: Phase 1 sends a common newsletter and
      // identifies subscribers by email, so `userId` is absent on most rows
      // until user accounts exist.
      await recipients.createIndex({ userId: 1, queuedAt: -1 }, { sparse: true });
      await recipients.createIndex({ providerMessageId: 1 }, { sparse: true });

      const newsletterEvents = db.collection<NewsletterEventDoc>('newsletter_events');
      await newsletterEvents.createIndex({ newsletterId: 1, event: 1 });
      await newsletterEvents.createIndex({ articleId: 1, event: 1 }, { sparse: true });
      await newsletterEvents.createIndex({ email: 1, timestamp: -1 });
      await newsletterEvents.createIndex({ userId: 1, timestamp: -1 }, { sparse: true });
      await newsletterEvents.createIndex(
        { timestamp: 1 },
        { expireAfterSeconds: 180 * 24 * 60 * 60 }
      );
    })().catch((error) => {
      // Let a later call retry instead of caching the failure forever.
      if (indexesReady === pending) indexesReady = null;
      throw error;
    });
    indexesReady = pending;
  }
  return indexesReady;
}

export async function getSubscribersCollection(): Promise<Collection<Subscriber>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<Subscriber>('subscribers');
}

export async function getIssuesCollection(): Promise<Collection<Issue>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<Issue>('issues');
}

/** Safe hex -> ObjectId for values coming from route params. Returns null when malformed. */
export function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}
