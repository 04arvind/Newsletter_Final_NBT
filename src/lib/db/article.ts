/**
 * Articles and topics.
 *
 * Every article extracted from a source lands here keyed by a derived, stable
 * `articleId`. The headline is explicitly *not* the identifier: NBT rewrites
 * headlines after publish, so keying on one would fork a single story into a
 * new row on every re-crawl and break the "already used in an issue" check.
 *
 * `category`, `contentType` and `eligibleSlots` are computed once at ingest and
 * stored, so picking a slot later is an indexed query rather than a regex sweep
 * over the whole pool.
 */

import { createHash } from 'crypto';
import type { AnyBulkWriteOperation, Collection, Filter, Sort } from 'mongodb';
import { getDb } from '../mongodb';
import { ensureDbIndexes } from './client';
import { ArticleClassificationSchema } from '../validation/article-classification';
import type {
  ArticleDoc,
  ArticleMetrics,
  ContentType,
  SlotId,
  TopicDoc,
} from './types';

export const ARTICLES_COLLECTION = 'articles';
export const TOPICS_COLLECTION = 'topics';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Tracking params that differ per referral but point at the same story. */
const TRACKING_PARAMS = /^(utm_|ref|source|from|fbclid|gclid|igshid|_branch)/i;

/**
 * Strip the query string and trailing slash so the same story arriving from the
 * sitemap, an AMP link and a social share collapses to one key.
 */
export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.protocol = 'https:';
    parsed.host = parsed.host.toLowerCase().replace(/^www\./, '');
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

/** `.../articleshow/124567890.cms` -> `124567890`. Times sites put the msid in the path. */
function extractMsid(url: string): string | null {
  const match = url.match(/\/(?:articleshow|photomazzashow|videoshow|liveblog)\/(\d{5,})\.cms/i);
  return match ? match[1] : null;
}

/**
 * Stable primary key for an article.
 *
 * Prefers the publisher's own msid, which survives headline edits, URL slug
 * changes and re-publishes. Falls back to a hash of the canonical URL for
 * sources that do not expose one.
 */
export function deriveArticleId(url: string): string {
  const canonical = canonicalizeUrl(url);
  const msid = extractMsid(canonical);
  if (msid) return `article_${msid}`;
  const hash = createHash('sha1').update(canonical).digest('hex').slice(0, 16);
  return `article_${hash}`;
}

/** `Gold Price` -> `topic_gold_price`. Deterministic, so the same story name always resolves to one topic. */
export function deriveTopicId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `topic_${slug || createHash('sha1').update(name).digest('hex').slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Classification
//
// Keyword-based on purpose: this runs over the full sitemap on every pipeline
// run, so it has to be free and instant. The model budget is spent on the six
// reader-facing summaries instead.
//
// NOTE: `phase1-selection.ts` carries its own copy of these rules for in-memory
// selection. If you change a term list here, change it there too, or a stored
// `eligibleSlots` will disagree with what the selector accepts.
// ---------------------------------------------------------------------------

const utilityTerms = ['money', 'finance', 'business', 'market', 'stock', 'share', 'gold', 'petrol', 'diesel', 'inflation', 'tax', 'salary', 'job', 'career', 'scheme', 'insurance', 'loan', 'bank', 'price', 'telecom', 'consumer', 'बजट', 'नौकरी', 'रोजगार', 'महंगाई', 'कीमत', 'योजना', 'बीमा', 'लोन', 'बैंक', 'टैक्स', 'सोना', 'पेट्रोल', 'डीजल', 'शेयर'];
const impactTerms = ['government', 'minister', 'cabinet', 'supreme court', 'high court', 'verdict', 'judgment', 'election', 'policy', 'law', 'bill', 'national security', 'army', 'border', 'war', 'conflict', 'disaster', 'earthquake', 'flood', 'cyclone', 'major accident', 'infrastructure', 'economy', 'सरकार', 'मंत्री', 'कैबिनेट', 'सुप्रीम कोर्ट', 'हाई कोर्ट', 'फैसला', 'चुनाव', 'नीति', 'कानून', 'सुरक्षा', 'सेना', 'सीमा', 'युद्ध', 'आपदा', 'भूकंप', 'बाढ़', 'चक्रवात', 'बड़ा हादसा', 'अर्थव्यवस्था'];
const curiosityTerms = ['why', 'how', 'explainer', 'explained', 'what is', 'know the reason', 'research', 'discovery', 'science', 'technology', 'data', 'study', 'unknown', 'hidden', 'surprising', 'unusual', 'क्या है', 'क्यों', 'कैसे', 'जानिए वजह', 'रिसर्च', 'खोज', 'विज्ञान', 'तकनीक', 'आंकड़े', 'अध्ययन', 'अनसुना', 'छिपा', 'हैरान', 'अनोखा'];
const eventTerms = ['launch', 'release', 'final', 'summit', 'election', 'hearing', 'announcement', 'festival', 'match', 'tournament', 'conference', 'लॉन्च', 'रिलीज', 'फाइनल', 'सम्मेलन', 'चुनाव', 'सुनवाई', 'घोषणा', 'त्योहार', 'मुकाबला', 'टूर्नामेंट'];
const engagementTerms = ['bollywood', 'tollywood', 'hollywood', 'movie', 'film', 'cinema', 'celebrity', 'actor', 'actress', 'singer', 'music', 'web series', 'web-series', 'ott', 'streaming', 'youtube', 'influencer', 'reality show', 'trailer', 'creator', 'content creator', 'गाना', 'गायिका', 'गायक', 'फिल्म', 'सिनेमा', 'बॉलीवुड', 'टॉलीवुड', 'हॉलीवुड', 'सेलिब्रिटी', 'अभिनेता', 'अभिनेत्री', 'वेब सीरीज', 'ओटीटी', 'यूट्यूब', 'इन्फ्लुएंसर', 'रियलिटी शो', 'ट्रेलर', 'क्रिएटर'];
const sportsTerms = ['sports', 'cricket', 'football', 'tennis', 'ipl', 'match', 'tournament', 'खेल', 'क्रिकेट', 'फुटबॉल', 'टेनिस', 'मुकाबला', 'टूर्नामेंट'];
const recipeTerms = ['recipe', 'halwa', 'food', 'dish', 'cooking', 'भोग', 'हलवा', 'रेसिपी', 'खाना', 'व्यंजन', 'पकवान'];

const futureHeadlinePattern = /scheduled|upcoming|will be held|to be held|set to|due on|next week|this week|tomorrow|20\d{2}|अगले सप्ताह|अगले हफ्ते|कल|आयोजित होगा|होने वाला|होगा|होगी|होंगे|लॉन्च डेट|रिलीज डेट/i;
const completedEventPattern = /already|was held|ended|out|scored|won|lost|completed|बरकरार|बनाए|बना चुके|बना लिया|आउट|जीत गया|हार गया|समाप्त/i;

const categoryRules: Array<[string, RegExp]> = [
  ['sports', /sports|cricket|football|tennis|ipl|match|olympics/i],
  ['business', /business|economy|market|stock|share|finance|company/i],
  ['technology', /tech|technology|ai|gadget|science|isro|space/i],
  ['entertainment', /entertainment|movie|cinema|bollywood|television|actor/i],
  ['world', /world|international|america|iran|russia|ukraine|pakistan/i],
  ['india', /india|delhi|mumbai|राज्य|सरकार|चुनाव|संसद/i],
];

/** Word-boundary match across Devanagari and Latin, so "india" never hits inside "indianapolis". */
function hasTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text);
  });
}

/** The minimum an article must expose to be classified before it is stored. */
export interface ClassifiableArticle {
  title: string;
  url?: string;
  description?: string;
  keywords?: string[];
  entities?: string[];
  tags?: string[];
  category?: string;
  subcategory?: string;
  topic?: string;
}

function classifyText(article: ClassifiableArticle): string {
  return [
    article.title,
    article.description,
    article.topic,
    article.category,
    article.subcategory,
    (article.keywords || []).join(' '),
    (article.tags || []).join(' '),
    article.url,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Trust an upstream category when the source gives one; otherwise infer from title and URL. */
export function categoryFor(article: ClassifiableArticle): string {
  if (article.category?.trim()) return article.category.trim().toLowerCase();
  const text = `${article.title} ${article.url || ''}`;
  return categoryRules.find(([, rule]) => rule.test(text))?.[0] || 'general';
}

/**
 * Every slot this article could legitimately fill.
 *
 * The negative terms matter: a box-office story mentions crores but is not
 * money-and-life utility, and a festival recipe mentions gold only as garnish.
 */
export function eligibleSlotsFor(article: ClassifiableArticle): SlotId[] {
  const text = classifyText(article);
  const engagementText = [
    article.category,
    article.subcategory,
    article.topic,
    article.title,
    (article.entities || []).join(' '),
    (article.keywords || []).join(' '),
    (article.tags || []).join(' '),
  ]
    .filter(Boolean)
    .join(' ');

  const isImpact = hasTerm(text, impactTerms) && !hasTerm(text, engagementTerms) && !hasTerm(text, recipeTerms);
  const isMoneyLife = hasTerm(text, utilityTerms) && !hasTerm(text, recipeTerms) && !hasTerm(text, engagementTerms);
  const isEngagement = hasTerm(engagementText, engagementTerms) && !hasTerm(engagementText, sportsTerms);
  const isCuriosity = hasTerm(text, curiosityTerms) && !hasTerm(text, recipeTerms) && !hasTerm(text, engagementTerms) && !hasTerm(text, utilityTerms);
  const isUpcoming = futureHeadlinePattern.test(article.title) &&
    hasTerm(article.title, eventTerms) &&
    !completedEventPattern.test(article.title);

  const slots: SlotId[] = [];
  if (isImpact) slots.push('slot_1');
  if (isMoneyLife) slots.push('slot_2');
  if (isEngagement) slots.push('slot_3');
  if (isCuriosity) slots.push('slot_4');
  if (isUpcoming) slots.push('slot_5');
  return slots;
}

/**
 * The single dominant character of a story — for reporting, and to break ties
 * when an article qualifies for several slots. Ordered by editorial priority.
 */
export function contentTypeFor(article: ClassifiableArticle): ContentType {
  const slots = eligibleSlotsFor(article);
  if (slots.includes('slot_5')) return 'event';
  if (slots.includes('slot_1')) return 'impact';
  if (slots.includes('slot_2')) return 'utility';
  if (slots.includes('slot_4')) return 'curiosity';
  if (slots.includes('slot_3')) return 'engagement';
  return 'general';
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export async function getArticlesCollection(): Promise<Collection<ArticleDoc>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<ArticleDoc>(ARTICLES_COLLECTION);
}

export async function getTopicsCollection(): Promise<Collection<TopicDoc>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<TopicDoc>(TOPICS_COLLECTION);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** What a fetcher hands in. Everything derived is computed here, not by the caller. */
export interface ArticleInput {
  title: string;
  url: string;
  description?: string;
  image?: string;
  source?: string;
  category?: string;
  subcategory?: string;
  topic?: string;
  subtopics?: string[];
  keywords?: string[];
  entities?: string[];
  tags?: string[];
  /** Optional at ingest — usually filled in later by `updateArticleEnrichment()`. */
  summary?: string;
  trendScore?: number;
  publishedAt: string | Date;
  updatedAt?: string | Date;
  metrics?: ArticleMetrics;
}

/** trendScore is stored 0-100; a caller handing in a raw ratio must not poison sorting. */
function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function toDate(value: string | Date | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Upsert a batch of freshly fetched articles.
 *
 * `ingestedAt` is `$setOnInsert` so a re-crawl never resets when we first saw a
 * story — that timestamp is what recency scoring and the "new since last issue"
 * check rely on. Everything else is refreshed, because upstream does edit
 * headlines and descriptions after publish.
 *
 * Articles with an unparseable `publishedAt` are skipped rather than stored with
 * a bogus date, which would let them win freshness scoring forever.
 */
export async function upsertArticles(
  inputs: ArticleInput[]
): Promise<{ upserted: number; modified: number; skipped: number }> {
  if (inputs.length === 0) return { upserted: 0, modified: 0, skipped: 0 };

  const now = new Date();
  const operations: AnyBulkWriteOperation<ArticleDoc>[] = [];
  let skipped = 0;

  // Collapse duplicates inside the batch: MongoDB rejects a bulkWrite that
  // touches the same _id twice in one unordered call.
  const seen = new Set<string>();

  for (const input of inputs) {
    const publishedAt = toDate(input.publishedAt);
    if (!publishedAt || !input.title?.trim() || !input.url?.trim()) {
      skipped += 1;
      continue;
    }

    const id = deriveArticleId(input.url);
    if (seen.has(id)) {
      skipped += 1;
      continue;
    }
    seen.add(id);

    const classifiable: ClassifiableArticle = {
      title: input.title,
      url: input.url,
      description: input.description,
      keywords: input.keywords,
      entities: input.entities,
      tags: input.tags,
      category: input.category,
      subcategory: input.subcategory,
      topic: input.topic,
    };

    // The five classification fields go through the Zod schema as one object
    // before the write, so nothing malformed reaches MongoDB. Values and rules
    // are unchanged; an article whose classification fails validation is
    // skipped, like the invalid-date and duplicate-id cases above.
    const classification = ArticleClassificationSchema.safeParse({
      category: categoryFor(classifiable),
      topic: input.topic,
      subtopics: input.subtopics || [],
      contentType: contentTypeFor(classifiable),
      eligibleSlots: eligibleSlotsFor(classifiable),
    });

    if (!classification.success) {
      console.error(
        `[Articles] Invalid classification for ${input.url}:`,
        classification.error.issues
      );
      skipped += 1;
      continue;
    }

    operations.push({
      updateOne: {
        filter: { _id: id },
        update: {
          $set: {
            title: input.title.trim(),
            description: input.description,
            url: input.url.trim(),
            canonicalUrl: canonicalizeUrl(input.url),
            image: input.image,
            source: input.source || 'NBT',
            category: classification.data.category,
            subcategory: input.subcategory,
            topic: classification.data.topic,
            topicId: input.topic ? deriveTopicId(input.topic) : undefined,
            subtopics: classification.data.subtopics,
            keywords: input.keywords || [],
            entities: input.entities || [],
            tags: input.tags || [],
            contentType: classification.data.contentType,
            eligibleSlots: classification.data.eligibleSlots,
            publishedAt,
            updatedAt: toDate(input.updatedAt),
            // Enrichment is set only when the caller actually supplies it. The
            // driver serializes `undefined` to null, so an unconditional `$set`
            // would let a plain re-crawl blank a summary or trendScore that a
            // later pipeline stage had already written.
            ...(input.summary !== undefined ? { summary: input.summary } : {}),
            ...(input.trendScore !== undefined
              ? { trendScore: clampScore(input.trendScore) }
              : {}),
            ...(input.metrics ? { metrics: { ...input.metrics, collectedAt: now } } : {}),
          },
          $setOnInsert: { ingestedAt: now },
        },
        upsert: true,
      },
    });
  }

  if (operations.length === 0) return { upserted: 0, modified: 0, skipped };

  const collection = await getArticlesCollection();
  const result = await collection.bulkWrite(operations, { ordered: false });
  return { upserted: result.upsertedCount, modified: result.modifiedCount, skipped };
}

/** Attach live traffic numbers without touching the editorial fields. */
export async function updateArticleMetrics(
  articleId: string,
  metrics: ArticleMetrics
): Promise<void> {
  const collection = await getArticlesCollection();
  await collection.updateOne(
    { _id: articleId },
    { $set: { metrics: { ...metrics, collectedAt: new Date() } } }
  );
}

/**
 * Write back what later pipeline stages produce: the model summary, derived
 * tags, and the topic trendScore copied down from `trend_features`.
 *
 * Batched, because a run scores every topic at once. Only the keys present on
 * an update are touched, so writing a trendScore never clears a summary an
 * earlier stage wrote. Updates for the same article are merged rather than
 * queued twice — a bulkWrite may not address one `_id` twice in a call.
 */
export async function updateArticleEnrichment(
  updates: Array<{
    articleId: string;
    summary?: string;
    tags?: string[];
    trendScore?: number;
  }>
): Promise<number> {
  type EnrichmentFields = Partial<Pick<ArticleDoc, 'summary' | 'tags' | 'trendScore'>>;
  const merged = new Map<string, EnrichmentFields>();

  for (const update of updates) {
    if (!update.articleId) continue;
    const fields: EnrichmentFields = merged.get(update.articleId) || {};
    if (update.summary !== undefined) fields.summary = update.summary;
    if (update.tags !== undefined) fields.tags = update.tags;
    if (update.trendScore !== undefined) fields.trendScore = clampScore(update.trendScore);
    if (Object.keys(fields).length > 0) merged.set(update.articleId, fields);
  }

  if (merged.size === 0) return 0;

  const operations: AnyBulkWriteOperation<ArticleDoc>[] = [...merged].map(
    ([articleId, fields]) => ({
      updateOne: { filter: { _id: articleId }, update: { $set: fields } },
    })
  );

  const collection = await getArticlesCollection();
  const result = await collection.bulkWrite(operations, { ordered: false });
  return result.modifiedCount;
}

/** Record that these articles shipped, so tomorrow's issue can exclude them. */
export async function markArticlesUsed(
  articleIds: string[],
  issueId: string
): Promise<void> {
  if (articleIds.length === 0) return;
  const collection = await getArticlesCollection();
  await collection.updateMany(
    { _id: { $in: articleIds } },
    { $set: { lastUsedInIssueId: issueId, lastUsedAt: new Date() } }
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface CandidateQuery {
  windowStart: Date;
  windowEnd: Date;
  /** Restrict to articles eligible for this slot. Omit for the whole pool. */
  slot?: SlotId;
  category?: string;
  /** Skip anything already used in an issue on or after this date. */
  excludeUsedSince?: Date;
  /** Only articles whose topic scored at least this. Omit to ignore trend score. */
  minTrendScore?: number;
  /** Freshest first (default), or hottest first off the trendScore index. */
  sortBy?: 'publishedAt' | 'trendScore';
  limit?: number;
}

/**
 * Articles publishable in the current editorial window.
 *
 * Backed by the `{ eligibleSlots, publishedAt }` index, so filling slot 2 reads
 * only the few hundred utility stories instead of scanning the whole window.
 */
export async function findCandidates(query: CandidateQuery): Promise<ArticleDoc[]> {
  const filter: Filter<ArticleDoc> = {
    publishedAt: { $gte: query.windowStart, $lt: query.windowEnd },
  };
  if (query.slot) filter.eligibleSlots = query.slot;
  if (query.category) filter.category = query.category;
  if (query.excludeUsedSince) {
    filter.$or = [
      { lastUsedAt: { $exists: false } },
      { lastUsedAt: { $lt: query.excludeUsedSince } },
    ];
  }

  if (query.minTrendScore !== undefined) {
    filter.trendScore = { $gte: query.minTrendScore };
  }

  const sort: Sort =
    query.sortBy === 'trendScore'
      ? { trendScore: -1, publishedAt: -1 }
      : { publishedAt: -1 };

  const collection = await getArticlesCollection();
  return collection
    .find(filter)
    .sort(sort)
    .limit(query.limit ?? 500)
    .toArray();
}

export async function findArticlesByIds(articleIds: string[]): Promise<ArticleDoc[]> {
  if (articleIds.length === 0) return [];
  const collection = await getArticlesCollection();
  return collection.find({ _id: { $in: articleIds } }).toArray();
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/**
 * Attach an article to its topic, creating the topic on first sight.
 *
 * `$addToSet` keeps this idempotent across re-crawls; `articleCount` is
 * denormalized so topic listings do not need an aggregation.
 */
export async function attachArticleToTopic(params: {
  topicName: string;
  category: string;
  articleId: string;
  publishedAt: Date;
  aliases?: string[];
}): Promise<string> {
  const topicId = deriveTopicId(params.topicName);
  const now = new Date();
  const collection = await getTopicsCollection();

  await collection.updateOne(
    { _id: topicId },
    {
      $set: {
        name: params.topicName,
        category: params.category,
        updatedAt: now,
      },
      $setOnInsert: { firstSeenAt: params.publishedAt, createdAt: now },
      $addToSet: {
        articleIds: params.articleId,
        ...(params.aliases?.length ? { aliases: { $each: params.aliases } } : {}),
      },
      $max: { lastArticleAt: params.publishedAt },
    },
    { upsert: true }
  );

  // Recount from the array rather than $inc, so a repeated call for the same
  // article cannot inflate the counter.
  await collection.updateOne({ _id: topicId }, [
    { $set: { articleCount: { $size: { $ifNull: ['$articleIds', []] } } } },
  ]);

  return topicId;
}

export async function findTopicsByIds(topicIds: string[]): Promise<TopicDoc[]> {
  if (topicIds.length === 0) return [];
  const collection = await getTopicsCollection();
  return collection.find({ _id: { $in: topicIds } }).toArray();
}
