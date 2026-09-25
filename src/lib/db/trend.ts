/**
 * Trend signals and trend features.
 *
 * Two collections with different jobs:
 *
 * - `external_trends` is an append-only log of raw readings (Google, Twitter).
 *   Never overwritten, so growth can be measured between samples.
 * - `trend_features` is the computed row the selector actually ranks on:
 *   velocity, acceleration, baseline ratio, the blended `trendScore`, and a
 *   `status` label. Also append-only, because this run's velocity is derived
 *   from the previous run's numbers.
 *
 * Both are scored per *topic*, not per article. A developing story publishes
 * five articles in an hour; scoring each one separately would split its signal
 * five ways and bury it under a single-article story with the same total reach.
 */

import { createHash } from 'crypto';
import type { AnyBulkWriteOperation, Collection } from 'mongodb';
import { getDb } from '../mongodb';
import { ensureDbIndexes } from './client';
import type {
  ExternalTrendDoc,
  ExternalTrendSource,
  TrendFeatureDoc,
  TrendStatus,
} from './types';
import { deriveTopicId } from './article';

export const EXTERNAL_TRENDS_COLLECTION = 'external_trends';
export const TREND_FEATURES_COLLECTION = 'trend_features';

export async function getExternalTrendsCollection(): Promise<Collection<ExternalTrendDoc>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<ExternalTrendDoc>(EXTERNAL_TRENDS_COLLECTION);
}

export async function getTrendFeaturesCollection(): Promise<Collection<TrendFeatureDoc>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<TrendFeatureDoc>(TREND_FEATURES_COLLECTION);
}

function readingId(topic: string, source: string, timestamp: Date): string {
  const hash = createHash('sha1')
    .update(`${topic}|${source}|${timestamp.toISOString()}`)
    .digest('hex')
    .slice(0, 16);
  return `trend_${hash}`;
}

// ---------------------------------------------------------------------------
// external_trends
// ---------------------------------------------------------------------------

export interface ExternalTrendInput {
  topic: string;
  keyword: string;
  source: ExternalTrendSource;
  trendScore: number;
  searchGrowth?: number;
  rank?: number;
  timestamp?: Date;
}

/**
 * Record a batch of raw external readings.
 *
 * The `_id` is derived from topic + source + timestamp, so re-running the
 * fetcher for the same minute is a no-op instead of a duplicate sample that
 * would skew the growth calculation.
 */
export async function recordExternalTrends(
  inputs: ExternalTrendInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;

  const operations: AnyBulkWriteOperation<ExternalTrendDoc>[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const timestamp = input.timestamp || new Date();
    const id = readingId(input.topic, input.source, timestamp);
    if (seen.has(id)) continue;
    seen.add(id);

    operations.push({
      updateOne: {
        filter: { _id: id },
        update: {
          $set: {
            topic: input.topic,
            topicId: deriveTopicId(input.topic),
            keyword: input.keyword,
            source: input.source,
            trendScore: clamp(input.trendScore, 0, 100),
            searchGrowth: input.searchGrowth,
            rank: input.rank,
            timestamp,
          },
        },
        upsert: true,
      },
    });
  }

  const collection = await getExternalTrendsCollection();
  const result = await collection.bulkWrite(operations, { ordered: false });
  return result.upsertedCount + result.modifiedCount;
}

/** Latest reading per source for one topic, newest first. */
export async function findRecentExternalTrends(
  topic: string,
  since: Date
): Promise<ExternalTrendDoc[]> {
  const collection = await getExternalTrendsCollection();
  return collection
    .find({ topic, timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .toArray();
}

// ---------------------------------------------------------------------------
// Feature calculation
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Live inputs for one topic at the moment of calculation. */
export interface TrendFeatureInput {
  topic: string;
  topicId?: string;

  views15m?: number;
  views1h?: number;
  views6h?: number;
  users1h?: number;

  /** 0-100 from `external_trends`, already blended across sources by the caller. */
  externalTrendScore?: number;
  /** Publish time of the topic's freshest article, for the recency component. */
  latestArticleAt?: Date;
  /** Rolling average views1h for this topic. Falls back to the 6h average. */
  baselineViews1h?: number;
}

/** What the previous run stored, used to derive velocity and acceleration. */
export interface PreviousTrendFeature {
  views1h?: number;
  velocity: number;
}

const HOT_SCORE = 75;
const RISING_SCORE = 60;
const COOLING_SCORE = 40;

/**
 * Turn raw counts into the ranked feature row.
 *
 * Weighting favours *change* over absolute size: a topic going from 2k to 18k
 * views in an hour is a better newsletter story than an evergreen page sitting
 * at a steady 50k, which subscribers have already seen.
 */
export function calculateTrendFeatures(
  input: TrendFeatureInput,
  previous?: PreviousTrendFeature | null,
  now = new Date()
): Omit<TrendFeatureDoc, '_id'> {
  const views1h = input.views1h ?? 0;
  const views6h = input.views6h ?? 0;

  // Velocity: growth against the previous sample. With no history, a topic is
  // treated as flat rather than exploding — otherwise every first sighting
  // would rank top.
  const previousViews = previous?.views1h ?? 0;
  const velocity = previousViews > 0 ? views1h / previousViews : 1;

  const acceleration = previous ? velocity - previous.velocity : 0;

  // Baseline: this topic against its own normal, so a niche topic tripling its
  // traffic can out-rank a big topic drifting along at its usual volume.
  const baseline = input.baselineViews1h ?? (views6h > 0 ? views6h / 6 : 0);
  const baselineRatio = baseline > 0 ? views1h / baseline : 1;

  // Engagement: unique users per view. A topic read by 12.5k distinct users is
  // broader than one where 2k people refreshed repeatedly.
  const engagementScore = views1h > 0 && input.users1h !== undefined
    ? clamp((input.users1h / views1h) * 100, 0, 100)
    : 0;

  const externalTrendScore = clamp(input.externalTrendScore ?? 0, 0, 100);

  // Recency decays over the 24h window; anything older is no longer news.
  const ageHours = input.latestArticleAt
    ? Math.max(0, (now.getTime() - input.latestArticleAt.getTime()) / 3_600_000)
    : 24;
  const recencyScore = clamp(100 - (ageHours / 24) * 100, 0, 100);

  // Normalize the unbounded ratios onto 0-100 before blending. 3x growth is
  // treated as the practical ceiling — beyond that it is almost always a spike
  // from a single viral link, not sustained interest.
  const velocityScore = clamp(((velocity - 1) / 2) * 100, 0, 100);
  const baselineScore = clamp(((baselineRatio - 1) / 2) * 100, 0, 100);
  const accelerationScore = clamp(50 + acceleration * 50, 0, 100);

  const trendScore = clamp(
    velocityScore * 0.3 +
      externalTrendScore * 0.25 +
      baselineScore * 0.15 +
      engagementScore * 0.15 +
      recencyScore * 0.1 +
      accelerationScore * 0.05,
    0,
    100
  );

  // Confidence tracks how many inputs were actually present. A score built on
  // one signal is not worth acting on, however high it reads.
  const signals = [
    input.views1h !== undefined,
    input.users1h !== undefined,
    input.externalTrendScore !== undefined,
    previous !== undefined && previous !== null,
    input.latestArticleAt !== undefined,
  ];
  const confidence = Math.round((signals.filter(Boolean).length / signals.length) * 100);

  return {
    topic: input.topic,
    topicId: input.topicId || deriveTopicId(input.topic),
    views15m: input.views15m,
    views1h: input.views1h,
    views6h: input.views6h,
    users1h: input.users1h,
    velocity: round(velocity),
    acceleration: round(acceleration),
    baselineRatio: round(baselineRatio),
    engagementScore: round(engagementScore),
    externalTrendScore: round(externalTrendScore),
    recencyScore: round(recencyScore),
    trendScore: round(trendScore),
    status: statusFor(trendScore, velocity, acceleration),
    confidence,
    calculatedAt: now,
  };
}

/**
 * The label editors read.
 *
 * Score alone is not enough: a topic can hold a high score while already fading,
 * so direction (velocity, acceleration) decides between HOT and COOLING.
 */
export function statusFor(
  trendScore: number,
  velocity: number,
  acceleration: number
): TrendStatus {
  if (trendScore >= HOT_SCORE && velocity >= 1.5) return 'HOT';
  if (trendScore >= RISING_SCORE && (velocity > 1.1 || acceleration > 0)) return 'RISING';
  if (trendScore < COOLING_SCORE) return 'COLD';
  if (velocity < 0.9) return 'COOLING';
  return 'STEADY';
}

// ---------------------------------------------------------------------------
// trend_features persistence
// ---------------------------------------------------------------------------

function featureId(topic: string, calculatedAt: Date): string {
  const hash = createHash('sha1')
    .update(`${topic}|${calculatedAt.toISOString()}`)
    .digest('hex')
    .slice(0, 16);
  return `trend_feature_${hash}`;
}

/** The previous feature row for a topic — the input `calculateTrendFeatures` needs for velocity. */
export async function findLatestTrendFeature(
  topic: string
): Promise<TrendFeatureDoc | null> {
  const collection = await getTrendFeaturesCollection();
  return collection.findOne({ topic }, { sort: { calculatedAt: -1 } });
}

/**
 * Calculate and store features for a batch of topics in one pass.
 *
 * Reads every topic's previous row up front rather than per topic, so a run
 * over a few hundred topics is two round trips instead of a few hundred.
 */
export async function calculateAndStoreTrendFeatures(
  inputs: TrendFeatureInput[],
  now = new Date()
): Promise<TrendFeatureDoc[]> {
  if (inputs.length === 0) return [];

  const collection = await getTrendFeaturesCollection();
  const topics = [...new Set(inputs.map((input) => input.topic))];

  // One row per topic: the newest, which is what velocity compares against.
  const previousRows = await collection
    .find({ topic: { $in: topics } })
    .sort({ calculatedAt: -1 })
    .toArray();
  const previousByTopic = new Map<string, TrendFeatureDoc>();
  for (const row of previousRows) {
    if (!previousByTopic.has(row.topic)) previousByTopic.set(row.topic, row);
  }

  const docs: TrendFeatureDoc[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const previous = previousByTopic.get(input.topic) || null;
    const features = calculateTrendFeatures(input, previous, now);
    const id = featureId(input.topic, now);
    if (seen.has(id)) continue;
    seen.add(id);
    docs.push({ _id: id, ...features });
  }

  if (docs.length === 0) return [];

  await collection.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: doc },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  return docs;
}

/**
 * Current standings: the newest feature row per topic, best score first.
 *
 * `minConfidence` defaults to 40 so a topic scored off a single signal does not
 * lead the newsletter.
 */
export async function findTopTrends(options?: {
  limit?: number;
  since?: Date;
  minConfidence?: number;
  status?: TrendStatus[];
}): Promise<TrendFeatureDoc[]> {
  const collection = await getTrendFeaturesCollection();
  const since = options?.since || new Date(Date.now() - 6 * 60 * 60 * 1000);
  const minConfidence = options?.minConfidence ?? 40;

  return collection
    .aggregate<TrendFeatureDoc>([
      {
        $match: {
          calculatedAt: { $gte: since },
          confidence: { $gte: minConfidence },
          ...(options?.status?.length ? { status: { $in: options.status } } : {}),
        },
      },
      { $sort: { calculatedAt: -1 } },
      { $group: { _id: '$topic', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { trendScore: -1 } },
      { $limit: options?.limit ?? 50 },
    ])
    .toArray();
}
