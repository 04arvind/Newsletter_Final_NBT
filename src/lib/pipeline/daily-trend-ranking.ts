/**
 * Daily trend ranking: the top trends of the 24 hours that end at 06:00 IST.
 *
 *     trend snapshots (trend_features, one batch per engine run)
 *            |
 *     group keyword variants into one canonical topic
 *            |
 *     aggregate each topic's trendScore over every snapshot in the window
 *            |
 *     daily_trend_rankings  (windowStart, windowEnd, trend, score, rank)
 *            |
 *     articles.trendScore   -> select.ts ranks on it, unchanged
 *
 * Why aggregate: the trend that happens to be #1 in the 06:00 snapshot is only
 * what is loudest at that instant. A story that led all afternoon and cooled
 * overnight is the bigger story of the day. So every snapshot in the window is
 * one sample, and a topic's daily score is its mean trendScore across *all*
 * samples — a sample in which the topic did not appear counts as 0. That
 * rewards both how hot a topic ran and for how long.
 *
 * The snapshots come from `runTrendEngine`, which already appends one feature
 * row per topic per run, all stamped with that run's `calculatedAt`. To have
 * more than one sample a day, `collectTrendSnapshot` is run on a schedule
 * (`/api/cron/trends`, e.g. hourly). Without it the window holds only the
 * 06:00 run and the ranking degrades to that single snapshot.
 */

import type { Collection } from 'mongodb';
import { deduplicateTrends, type RawTrend } from '../dedup';
import { findCandidates, findTopicsByIds, deriveTopicId, updateArticleEnrichment } from '../db/article';
import { getTrendFeaturesCollection } from '../db/trend';
import type { TrendFeatureDoc } from '../db/types';
import { getDb } from '../mongodb';
import { getNewsletterWindow, type NewsletterWindow } from '../newsletter-window';
import { ingestArticles } from './ingest';
import { runTrendEngine, type TrendEngineResult } from './trend-engine';

export const DAILY_TREND_RANKINGS_COLLECTION = 'daily_trend_rankings';

/**
 * The 06:00 pipeline run takes its snapshot a few seconds or minutes after
 * 06:00. That snapshot closes the window ending at 06:00, not the next one, so
 * both window edges are shifted by this much when picking snapshots. Each
 * snapshot still lands in exactly one window.
 */
const SNAPSHOT_GRACE_MS = 30 * 60 * 1000;
/** Upper bound on the article pool the score is copied onto. */
const CANDIDATE_LIMIT = 2000;

export interface DailyTrendRankingDoc {
  _id: string;
  windowStart: Date;
  windowEnd: Date;
  /** Canonical topic name: the strongest keyword variant in its group. */
  trend: string;
  /** 0-100. Mean trendScore across every snapshot in the window. */
  score: number;
  /** 1 is the top trend of the window. */
  rank: number;
  /** Every `trend_features.topic` merged into this trend. */
  aliases: string[];
  /** Snapshots in which this trend appeared, out of `totalSnapshots`. */
  snapshotCount: number;
  totalSnapshots: number;
  peakScore: number;
  calculatedAt: Date;
}

export interface RankedDailyTrend {
  trend: string;
  score: number;
  rank: number;
  aliases: string[];
  snapshotCount: number;
  totalSnapshots: number;
  peakScore: number;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Group snapshot rows into canonical topics and rank them over the window.
 *
 * Pure. Keyword variants ("IND vs PAK", "India vs Pakistan", "भारत पाकिस्तान")
 * are grouped with `deduplicateTrends`, the same matcher that merges Google and
 * Twitter keywords within a run. Within one snapshot a group scores its best
 * member, so two variants trending side by side are not counted twice.
 */
export function aggregateTrendSnapshots(features: TrendFeatureDoc[]): RankedDailyTrend[] {
  if (features.length === 0) return [];

  const snapshotKeys = new Set(features.map((row) => row.calculatedAt.getTime()));
  const totalSnapshots = snapshotKeys.size;

  // Feed topic names strongest-first, so each group is named after the
  // variant that carried the most score over the day.
  const totalByTopic = new Map<string, number>();
  for (const row of features) {
    totalByTopic.set(row.topic, (totalByTopic.get(row.topic) || 0) + row.trendScore);
  }
  const raw: RawTrend[] = [...totalByTopic]
    .sort((a, b) => b[1] - a[1])
    .map(([topic]) => ({ keyword: topic, source: 'google', fetchedAt: '' }));

  const groups = deduplicateTrends(raw);
  const groupByTopic = new Map<string, string>();
  for (const group of groups) {
    for (const alias of group.originalKeywords) groupByTopic.set(alias, group.keyword);
  }

  // canonical -> snapshot -> best member score in that snapshot
  const perSnapshot = new Map<string, Map<number, number>>();
  for (const row of features) {
    const canonical = groupByTopic.get(row.topic) ?? row.topic;
    const samples = perSnapshot.get(canonical) || new Map<number, number>();
    const key = row.calculatedAt.getTime();
    samples.set(key, Math.max(samples.get(key) ?? 0, row.trendScore));
    perSnapshot.set(canonical, samples);
  }

  const aliasesByCanonical = new Map(
    groups.map((group) => [group.keyword, [...new Set(group.originalKeywords)]])
  );

  return [...perSnapshot]
    .map(([trend, samples]) => {
      const scores = [...samples.values()];
      const total = scores.reduce((sum, score) => sum + score, 0);
      return {
        trend,
        score: round(total / totalSnapshots),
        aliases: aliasesByCanonical.get(trend) || [trend],
        snapshotCount: scores.length,
        totalSnapshots,
        peakScore: round(Math.max(...scores)),
      };
    })
    .sort((a, b) => b.score - a.score || b.peakScore - a.peakScore || a.trend.localeCompare(b.trend))
    .map((trend, index) => ({ ...trend, rank: index + 1 }));
}

async function getDailyTrendRankingsCollection(): Promise<Collection<DailyTrendRankingDoc>> {
  const db = await getDb();
  const collection = db.collection<DailyTrendRankingDoc>(DAILY_TREND_RANKINGS_COLLECTION);
  await collection.createIndex({ windowEnd: -1, rank: 1 });
  return collection;
}

/** Stored ranking for a window, #1 first. */
export async function findDailyTrendRanking(
  window: Pick<NewsletterWindow, 'windowEnd'> = getNewsletterWindow()
): Promise<DailyTrendRankingDoc[]> {
  const collection = await getDailyTrendRankingsCollection();
  return collection.find({ windowEnd: window.windowEnd }).sort({ rank: 1 }).toArray();
}

/**
 * Rank the window's trends, store the ranking, and hand it to article ranking.
 *
 * Idempotent: a re-run for the same window replaces that window's rows.
 *
 * The daily score is copied onto the window's articles as `trendScore` — the
 * field `select.ts` already ranks on — replacing the single-snapshot score the
 * engine wrote, so the newsletter ranks on the 24-hour picture.
 */
export async function rankDailyTrends(options?: {
  window?: NewsletterWindow;
  now?: Date;
}): Promise<RankedDailyTrend[]> {
  const window = options?.window || getNewsletterWindow(options?.now);
  const now = options?.now || new Date();

  const features = await (await getTrendFeaturesCollection())
    .find({
      calculatedAt: {
        $gte: new Date(window.windowStart.getTime() + SNAPSHOT_GRACE_MS),
        $lt: new Date(window.windowEnd.getTime() + SNAPSHOT_GRACE_MS),
      },
    })
    .toArray();

  const ranked = aggregateTrendSnapshots(features);

  const collection = await getDailyTrendRankingsCollection();
  await collection.deleteMany({ windowEnd: window.windowEnd });
  if (ranked.length > 0) {
    await collection.insertMany(
      ranked.map((trend) => ({
        _id: `daily_trend_${window.windowEndIso}_${trend.rank}`,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        ...trend,
        calculatedAt: now,
      }))
    );
  }

  await applyRankingToArticles(ranked, window);
  return ranked;
}

/** Copy each trend's daily score onto the window's articles that cover it. */
async function applyRankingToArticles(
  ranked: RankedDailyTrend[],
  window: NewsletterWindow
): Promise<void> {
  if (ranked.length === 0) return;

  const scoreByTopicId = new Map<string, number>();
  for (const trend of ranked) {
    for (const alias of trend.aliases) scoreByTopicId.set(deriveTopicId(alias), trend.score);
  }

  const [topics, articles] = await Promise.all([
    findTopicsByIds([...scoreByTopicId.keys()]),
    findCandidates({
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      limit: CANDIDATE_LIMIT,
    }),
  ]);
  const inWindow = new Set(articles.map((doc) => doc._id));

  // An article covering more than one trend takes the strongest.
  const scoreByArticle = new Map<string, number>();
  for (const topic of topics) {
    const score = scoreByTopicId.get(topic._id);
    if (score === undefined) continue;
    for (const articleId of topic.articleIds || []) {
      if (!inWindow.has(articleId)) continue;
      scoreByArticle.set(articleId, Math.max(scoreByArticle.get(articleId) ?? 0, score));
    }
  }

  await updateArticleEnrichment(
    [...scoreByArticle].map(([articleId, trendScore]) => ({ articleId, trendScore }))
  );
}

/**
 * Take one intra-day trend snapshot over the trailing 24 hours.
 *
 * Runs ingest first so the engine can match trends against what published
 * since 06:00 — the engine only scores a trend that some article covers.
 */
export async function collectTrendSnapshot(now = new Date()): Promise<TrendEngineResult> {
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const window: NewsletterWindow = {
    issueAt: windowEnd,
    windowStart,
    windowEnd,
    windowStartIso: windowStart.toISOString(),
    windowEndIso: windowEnd.toISOString(),
    cacheKey: `snapshot:${windowStart.toISOString()}:${windowEnd.toISOString()}`,
  };

  await ingestArticles(window);
  return runTrendEngine({ window, now });
}
