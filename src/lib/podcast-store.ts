/**
 * `podcast_events` — one document per podcast, keyed by `podcastId`.
 *
 * Two writers share each document, and neither ever inserts a second copy:
 *
 *   - ranking (`upsertRankedPodcasts`) refreshes the score, rank and metadata
 *     every time `getTopPodcastOfDay` runs;
 *   - page analytics (`recordPodcastEvent`) only bumps the impression / click
 *     counters on the podcast's existing document.
 *
 * The newsletter's pick is then read back from here (`findTopRankedPodcast`),
 * so a podcast whose score moves between runs is reflected automatically.
 *
 * The collection used to hold one row per impression. `ensureIndexes()`
 * collapses any such leftovers to a single row per podcast before adding the
 * unique index, so an existing database migrates itself on first use.
 */

import { getDb, isMongoConfigured } from './mongodb';
import type { Podcast } from './fetch-podcasts';

const COLLECTION = 'podcast_events';

export type PodcastEventName = 'podcast_impression' | 'podcast_click';

interface PodcastDoc extends Omit<Podcast, 'id'> {
  podcastId: string;
  podcastTitle: string;
  podcastScore?: number;
  rank?: number;
  lastRankedAt?: Date;
  impressions?: number;
  clicks?: number;
  newsletterDate?: string;
  lastEventAt?: Date;
  firstSeenAt: Date;
}

let indexesReady: Promise<void> | null = null;

/** Idempotent, lazy — runs once per process, retried if it fails. */
function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    const pending = (async () => {
      const db = await getDb();
      const collection = db.collection(COLLECTION);

      // Collapse the old one-row-per-impression log to the newest row per podcast.
      const duplicates = await collection
        .aggregate<{ ids: unknown[] }>([
          { $sort: { timestamp: -1, _id: -1 } },
          { $group: { _id: '$podcastId', ids: { $push: '$_id' }, count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
        ])
        .toArray();
      const stale = duplicates.flatMap((group) => group.ids.slice(1));
      if (stale.length > 0) await collection.deleteMany({ _id: { $in: stale as never[] } });

      // The old non-unique index has the same default name as the unique one.
      const existing = await collection.indexes().catch(() => []);
      if (existing.some((index) => index.name === 'podcastId_1' && !index.unique)) {
        await collection.dropIndex('podcastId_1');
      }

      await collection.createIndex({ podcastId: 1 }, { unique: true });
      await collection.createIndex({ lastRankedAt: -1, finalScore: -1 });
    })().catch((error) => {
      // Let a later call retry instead of caching the failure forever.
      if (indexesReady === pending) indexesReady = null;
      throw error;
    });
    indexesReady = pending;
  }
  return indexesReady;
}

async function podcastCollection() {
  await ensureIndexes();
  const db = await getDb();
  return db.collection<PodcastDoc>(COLLECTION);
}

/** Insert new podcasts, refresh score/rank/metadata on the ones already stored. */
export async function upsertRankedPodcasts(ranked: Podcast[]): Promise<void> {
  if (ranked.length === 0) return;
  const collection = await podcastCollection();
  const now = new Date();
  await collection.bulkWrite(
    ranked.map(({ id, ...podcast }, index) => ({
      updateOne: {
        filter: { podcastId: id },
        update: {
          $set: {
            ...podcast,
            podcastId: id,
            podcastTitle: podcast.title,
            podcastScore: podcast.finalScore,
            rank: index + 1,
            lastRankedAt: now,
          },
          $setOnInsert: { firstSeenAt: now },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

/** Highest-scoring podcast ranked since `since`, or null. */
export async function findTopRankedPodcast(since: Date): Promise<Podcast | null> {
  const collection = await podcastCollection();
  const doc = await collection.findOne(
    { lastRankedAt: { $gte: since }, finalScore: { $exists: true } },
    { sort: { finalScore: -1, freshness: -1 } }
  );
  if (!doc) return null;
  return {
    id: doc.podcastId,
    videoId: doc.videoId,
    title: doc.title,
    url: doc.url,
    embedUrl: doc.embedUrl,
    thumbnail: doc.thumbnail,
    description: doc.description,
    publishedAt: doc.publishedAt,
    category: doc.category,
    duration: doc.duration,
    author: doc.author,
    views: doc.views,
    viewsPerHour: doc.viewsPerHour,
    source: doc.source,
    entities: doc.entities,
    topics: doc.topics,
    trendVelocity: doc.trendVelocity,
    topicPopularity: doc.topicPopularity,
    freshness: doc.freshness,
    massAppeal: doc.massAppeal,
    curiosity: doc.curiosity,
    newsImportance: doc.newsImportance,
    newsletterFit: doc.newsletterFit,
    finalScore: doc.finalScore,
    scoreReason: doc.scoreReason,
  };
}

/**
 * Count an impression or click against the podcast's single document.
 *
 * The client-sent title/score only seed a podcast that ranking has not stored
 * yet; they never overwrite the ranking's own values.
 */
export async function recordPodcastEvent(input: {
  event: PodcastEventName;
  podcastId: string;
  podcastTitle: string;
  podcastScore?: number;
  newsletterDate?: string;
}): Promise<void> {
  const collection = await podcastCollection();
  const now = new Date();
  await collection.updateOne(
    { podcastId: input.podcastId },
    {
      $inc: input.event === 'podcast_click' ? { clicks: 1 } : { impressions: 1 },
      $set: {
        lastEventAt: now,
        ...(input.newsletterDate ? { newsletterDate: input.newsletterDate } : {}),
      },
      $setOnInsert: {
        podcastTitle: input.podcastTitle,
        ...(typeof input.podcastScore === 'number' ? { podcastScore: input.podcastScore } : {}),
        firstSeenAt: now,
      },
    },
    { upsert: true }
  );
}

export { isMongoConfigured as isPodcastStoreEnabled };
