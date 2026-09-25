/**
 * Pipeline stages 4-6: external trend signals -> trend engine -> trend score.
 *
 *     External Trend Signals
 *            |
 *        TREND ENGINE
 *            |
 *        Trend Score
 *
 * The join between a trend and our content is the *topic*, not the article. A
 * developing story publishes five articles in an hour; scoring each separately
 * splits its signal five ways and buries it under a single-article story with
 * the same total reach. So:
 *
 *   1. Google + Twitter trends are deduplicated into one keyword per real-world
 *      story (`deduplicateTrends`), and every raw reading is appended to
 *      `external_trends` so growth can be measured between runs.
 *   2. Each surviving keyword becomes a topic, and the articles that cover it
 *      are matched with the existing cross-language matcher (`rankTrends` ->
 *      `detectCoverage`) and attached to it in `topics`.
 *   3. `trend_features` gets one computed row per topic — velocity,
 *      acceleration, baseline ratio and the blended `trendScore`.
 *   4. That trendScore is copied down onto the topic's articles, so slot
 *      filling can rank on it without a join.
 *
 * GA traffic is the one input that is not wired yet (`src/lib/GA/data.ts` is
 * empty). The engine reads whatever `metrics` an article already carries and
 * degrades without them: velocity and baseline fall back to neutral and
 * `confidence` drops accordingly, which is exactly what it is there to signal.
 * Filling in a metrics provider later needs no change to this file.
 */

import { deduplicateTrends, type RawTrend, type UniqueTrend } from '../dedup';
import { normalizeForComparison } from '../hindi-utils';
import { fetchGoogleTrends } from '../fetch-google-trends';
import { fetchTwitterTrends } from '../fetch-twitter-trends';
import { getNewsletterWindow, type NewsletterWindow } from '../newsletter-window';
import { rankTrends, type Article as ScoringArticle, type RankedTrend } from '../scoring';
import {
  attachArticleToTopic,
  findCandidates,
  updateArticleEnrichment,
} from '../db/article';
import {
  calculateAndStoreTrendFeatures,
  recordExternalTrends,
  type ExternalTrendInput,
  type TrendFeatureInput,
} from '../db/trend';
import type { ArticleDoc, TrendFeatureDoc } from '../db/types';

/** How many ranked trends become topics. Beyond this the tail is noise. */
const DEFAULT_TOP_N = 25;
/** Upper bound on the article pool a single run reads out of Mongo. */
const CANDIDATE_LIMIT = 2000;

export interface TrendEngineResult {
  googleTrends: number;
  twitterTrends: number;
  uniqueTrends: number;
  externalReadings: number;
  topicsScored: number;
  articlesScored: number;
  features: TrendFeatureDoc[];
  /** Sources that failed this run. The engine continues on whatever is left. */
  sourceErrors: string[];
}

// ---------------------------------------------------------------------------
// Entertainment trending (Slot 3)
//
// Slot 3 wants the trending film / music / sport / social story. The external
// sources cannot supply it: Google Trends geo=IN returns mostly Telugu, Tamil,
// Malayalam and Kannada keywords, and the Twitter India list is dominated by
// contest hashtags and their poll options ("B. IP68", "A. 45W"). Measured on a
// live window: 0 of 14 slot-3 articles matched any trend keyword, even on a
// loose token overlap.
//
// So the signal is taken from our own coverage instead of a new external feed:
// when the newsroom files several stories on one film, star or match inside the
// window, that IS the trending entertainment story. A story is identified by a
// shared bigram — single words like "film" or "song" are far too generic, and
// bigrams are the same device the selector already uses to detect duplicates.
// ---------------------------------------------------------------------------

/** Tokens that pair with anything and would merge unrelated stories. */
const ENTERTAINMENT_STOPWORDS = new Set([
  'और', 'का', 'के', 'की', 'में', 'से', 'को', 'ने', 'पर', 'यह', 'एक', 'है', 'हैं',
  'पर', 'तक', 'लिए', 'साथ', 'बाद', 'रहा', 'रही', 'गया', 'गई', 'दिया', 'किया',
  'the', 'and', 'for', 'with', 'from', 'after', 'before', 'this', 'that', 'his',
  'her', 'new', 'has', 'was', 'are', 'you', 'out', 'all', 'now',
]);

/** Distinct two-word keys identifying the story an article is about. */
function storyBigrams(doc: ArticleDoc): string[] {
  const normalized = normalizeForComparison(
    `${doc.title} ${(doc.keywords || []).join(' ')}`
  );
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 2 && !ENTERTAINMENT_STOPWORDS.has(token));

  const keys: string[] = [];
  for (let index = 0; index < tokens.length - 1; index++) {
    keys.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return [...new Set(keys)];
}

/**
 * Score entertainment articles 0-100 by how much coverage their story is
 * getting in this window, weighted towards how recent that coverage is.
 *
 * Pure: it writes nothing and reads nothing outside the documents handed in, so
 * it cannot disturb the external trend pass or any other slot's inputs.
 *
 * Coverage carries most of the weight — five stories on one film is a stronger
 * statement of what is trending than one story filed ten minutes ago — but
 * recency breaks ties so a day-old story cannot hold the slot.
 */
export function scoreEntertainmentTrends(
  docs: ArticleDoc[],
  now = new Date()
): Map<string, number> {
  const scores = new Map<string, number>();
  if (docs.length === 0) return scores;

  const keysByDoc = new Map(docs.map((doc) => [doc._id, storyBigrams(doc)]));

  // How many distinct articles share each story key.
  const articlesPerKey = new Map<string, number>();
  for (const keys of keysByDoc.values()) {
    for (const key of keys) {
      articlesPerKey.set(key, (articlesPerKey.get(key) || 0) + 1);
    }
  }

  // An article's coverage is its best-covered story key: the size of the
  // largest cluster it belongs to.
  const coverageByDoc = new Map<string, number>();
  for (const [id, keys] of keysByDoc) {
    coverageByDoc.set(
      id,
      keys.reduce((most, key) => Math.max(most, articlesPerKey.get(key) || 1), 1)
    );
  }

  const coverages = [...coverageByDoc.values()];
  const minCoverage = Math.min(...coverages);
  const maxCoverage = Math.max(...coverages);

  for (const doc of docs) {
    const coverage = coverageByDoc.get(doc._id) ?? 1;
    // Everything equally covered means coverage says nothing; let recency rank.
    const coverageScore = maxCoverage > minCoverage
      ? ((coverage - minCoverage) / (maxCoverage - minCoverage)) * 100
      : 0;

    const ageHours = Math.max(
      0,
      (now.getTime() - doc.publishedAt.getTime()) / 3_600_000
    );
    const recencyScore = Math.max(0, 100 - (ageHours / 24) * 100);

    scores.set(doc._id, Math.round((coverageScore * 0.7 + recencyScore * 0.3) * 100) / 100);
  }

  return scores;
}

/** Rank position -> 0-100. #1 scores 100 and the list decays linearly. */
function scoreFromRank(position: number, total: number): number {
  if (total <= 1) return 100;
  return Math.round(Math.max(0, 100 - (position / total) * 100));
}

/** ArticleDoc -> the shape `rankTrends`/`detectCoverage` matches against. */
function toScoringArticle(doc: ArticleDoc): ScoringArticle {
  return {
    url: doc.url,
    title: doc.title,
    keywords: doc.keywords,
    publishedAt: doc.publishedAt.toISOString(),
    articleId: doc._id,
    description: doc.description,
    category: doc.category,
    subcategory: doc.subcategory,
    topic: doc.topic,
    entities: doc.entities,
  };
}

/**
 * Roll a topic's article traffic up into one set of counts.
 *
 * Returns `undefined` for a metric no article reported, rather than 0 — the
 * difference matters: 0 means "nobody read it", undefined means "we have no
 * data", and only the second should lower `confidence` instead of the score.
 */
function rollUpMetrics(docs: ArticleDoc[]) {
  const sum = (pick: (doc: ArticleDoc) => number | undefined): number | undefined => {
    const values = docs.map(pick).filter((value): value is number => typeof value === 'number');
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
  };

  return {
    views15m: sum((doc) => doc.metrics?.views15m),
    views1h: sum((doc) => doc.metrics?.views1h),
    views6h: sum((doc) => doc.metrics?.views6h),
    users1h: sum((doc) => doc.metrics?.users1h),
  };
}

/** Fetch both signal sources, tolerating either one being down. */
async function fetchSignals(): Promise<{
  raw: RawTrend[];
  googleCount: number;
  twitterCount: number;
  errors: string[];
}> {
  const [google, twitter] = await Promise.allSettled([
    fetchGoogleTrends(),
    fetchTwitterTrends(),
  ]);

  const raw: RawTrend[] = [];
  const errors: string[] = [];
  let googleCount = 0;
  let twitterCount = 0;

  if (google.status === 'fulfilled') {
    googleCount = google.value.trends.length;
    for (const trend of google.value.trends) {
      raw.push({ keyword: trend.keyword, source: 'google', fetchedAt: trend.fetchedAt });
    }
  } else {
    errors.push(`google_trends: ${google.reason}`);
  }

  if (twitter.status === 'fulfilled') {
    twitterCount = twitter.value.trends.length;
    for (const trend of twitter.value.trends) {
      raw.push({ keyword: trend.keyword, source: 'twitter', fetchedAt: trend.fetchedAt });
    }
  } else {
    errors.push(`twitter_trends: ${twitter.reason}`);
  }

  return { raw, googleCount, twitterCount, errors };
}

/**
 * Append this run's raw readings to `external_trends`.
 *
 * One row per (topic, source), scored by the keyword's position in that
 * source's list. These are never overwritten — the history is what lets a later
 * run measure how fast a topic is growing.
 */
async function persistExternalSignals(
  unique: UniqueTrend[],
  timestamp: Date
): Promise<number> {
  const inputs: ExternalTrendInput[] = [];

  unique.forEach((trend, position) => {
    const base = {
      topic: trend.keyword,
      keyword: trend.normalizedKeyword,
      trendScore: scoreFromRank(position, unique.length),
      rank: position + 1,
      timestamp,
    };
    if (trend.googleCount > 0) inputs.push({ ...base, source: 'google_trends' });
    if (trend.twitterCount > 0) inputs.push({ ...base, source: 'twitter' });
  });

  return recordExternalTrends(inputs);
}

/**
 * Run the trend engine over the current window.
 *
 * Safe to run repeatedly: external readings dedupe on (topic, source, minute),
 * topic attachment is `$addToSet`, and each run appends one feature row per
 * topic, which is what velocity compares against next time.
 */
export async function runTrendEngine(options?: {
  window?: NewsletterWindow;
  topN?: number;
  now?: Date;
}): Promise<TrendEngineResult> {
  const window = options?.window || getNewsletterWindow();
  const now = options?.now || new Date();
  const topN = options?.topN ?? DEFAULT_TOP_N;

  // --- 4. external trend signals -----------------------------------------
  const signals = await fetchSignals();
  const unique = deduplicateTrends(signals.raw);
  const externalReadings = await persistExternalSignals(unique, now);

  // --- 5. trend engine: match signals to our content ----------------------
  const articles = await findCandidates({
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    limit: CANDIDATE_LIMIT,
  });

  if (unique.length === 0 || articles.length === 0) {
    return {
      googleTrends: signals.googleCount,
      twitterTrends: signals.twitterCount,
      uniqueTrends: unique.length,
      externalReadings,
      topicsScored: 0,
      articlesScored: 0,
      features: [],
      sourceErrors: signals.errors,
    };
  }

  const byUrl = new Map(articles.map((doc) => [doc.url, doc]));
  const ranked: RankedTrend[] = rankTrends(unique, articles.map(toScoringArticle), topN);

  // Normalize the ranked scores onto 0-100 within this run. `scoreTrend`'s
  // absolute range depends on how many sources reported, so comparing raw
  // values across runs would drift.
  const maxRankedScore = Math.max(...ranked.map((trend) => trend.score), 1);

  const featureInputs: TrendFeatureInput[] = [];
  const topicArticles = new Map<string, ArticleDoc[]>();

  for (const trend of ranked) {
    const docs = trend.matchedArticles
      .map((match) => byUrl.get(match.url))
      .filter((doc): doc is ArticleDoc => Boolean(doc));

    // A trend nothing covers has no story to put in the newsletter. It stays in
    // `external_trends` as a signal, but it is not scored as a topic.
    if (docs.length === 0) continue;

    topicArticles.set(trend.keyword, docs);

    const latestArticleAt = docs.reduce<Date>(
      (latest, doc) => (doc.publishedAt > latest ? doc.publishedAt : latest),
      docs[0].publishedAt
    );

    featureInputs.push({
      topic: trend.keyword,
      ...rollUpMetrics(docs),
      externalTrendScore: Math.round((trend.score / maxRankedScore) * 100),
      latestArticleAt,
    });
  }

  // Group each topic's articles in `topics` before scoring, so a topic row
  // exists for anything the feature rows reference.
  //
  // NOTE: the grouping is deliberately NOT written back to `articles.topicId`.
  // A topic here is "articles covering this trending keyword", which is coarser
  // than one story — a broad keyword such as "Pakistan Navy" sweeps in several
  // unrelated stories. `select.ts` maps `topicId` onto the selector's story
  // cluster, so persisting it would make dedup treat those unrelated stories as
  // one and silently drop all but the first from the whole issue.
  for (const [topicName, docs] of topicArticles) {
    for (const doc of docs) {
      await attachArticleToTopic({
        topicName,
        category: doc.category,
        articleId: doc._id,
        publishedAt: doc.publishedAt,
      });
    }
  }

  // --- 6. trend score ------------------------------------------------------
  const features = await calculateAndStoreTrendFeatures(featureInputs, now);

  // Copy each topic's score down onto its articles so slot filling can rank on
  // it directly. `trend_features` stays the source of truth.
  const scoreByTopic = new Map(features.map((feature) => [feature.topic, feature.trendScore]));
  const enrichment: Array<{ articleId: string; trendScore: number }> = [];
  for (const [topicName, docs] of topicArticles) {
    const trendScore = scoreByTopic.get(topicName);
    if (trendScore === undefined) continue;
    for (const doc of docs) {
      enrichment.push({ articleId: doc._id, trendScore });
    }
  }
  await updateArticleEnrichment(enrichment);

  return {
    googleTrends: signals.googleCount,
    twitterTrends: signals.twitterCount,
    uniqueTrends: unique.length,
    externalReadings,
    topicsScored: features.length,
    articlesScored: enrichment.length,
    features,
    sourceErrors: signals.errors,
  };
}
