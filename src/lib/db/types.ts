/**
 * MongoDB document shapes for the newsletter engine.
 *
 * One file for every collection's schema so the contract is readable in one
 * place; the read/write helpers live next to them in `article.ts`, `trend.ts`,
 * `event.ts` and `newsletter.ts`.
 *
 * Convention: these collections use **string `_id`s** (`article_<msid>`,
 * `topic_gold_price`, `newsletter_2026_09_16`) rather than ObjectIds, so the
 * same document can be upserted idempotently from a re-run of the pipeline
 * without a lookup first. `subscribers` and `issues` in `client.ts` predate
 * this and keep their ObjectIds.
 */

/** The five editorial slots in an issue. Slot 5 carries an event, not an article. */
export type SlotId = 'slot_1' | 'slot_2' | 'slot_3' | 'slot_4' | 'slot_5';

export const SLOT_IDS: SlotId[] = ['slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5'];

/** What each slot is editorially for — mirrors `slotDefinitions` in phase1-selection.ts. */
export const SLOT_THEMES: Record<SlotId, string> = {
  slot_1: 'biggest_impact',
  slot_2: 'money_life_impact',
  slot_3: 'highest_engagement',
  slot_4: 'curiosity_discovery',
  slot_5: 'big_upcoming_event',
};

/**
 * Dominant editorial character of a story. An article has exactly one, but may
 * still be eligible for several slots.
 */
export type ContentType =
  | 'impact'
  | 'utility'
  | 'engagement'
  | 'curiosity'
  | 'event'
  | 'general';

export type TrendStatus = 'HOT' | 'RISING' | 'STEADY' | 'COOLING' | 'COLD';

export type ExternalTrendSource = 'google_trends' | 'twitter' | 'internal';

// ---------------------------------------------------------------------------
// articles
// ---------------------------------------------------------------------------

/**
 * One article extracted from a source (sitemap today, more later).
 *
 * `_id` is a derived, stable articleId — never the headline or description,
 * which get edited upstream after publish and would fork into duplicate rows.
 * See `deriveArticleId()` in `article.ts`.
 */
export interface ArticleDoc {
  _id: string;

  title: string;
  description?: string;
  url: string;
  /** Canonical, query-stripped URL. The uniqueness key alongside `_id`. */
  canonicalUrl: string;
  image?: string;
  source: string;

  category: string;
  subcategory?: string;
  /** FK into `topics._id`. Groups articles about one developing story. */
  topicId?: string;
  topic?: string;
  subtopics: string[];
  /** What the source shipped with the article. */
  keywords: string[];
  entities: string[];
  /** Labels we assign ourselves, from classification and topic grouping. */
  tags: string[];

  /**
   * Reader-facing one-liner, written by the model after ingest rather than at
   * crawl time. Only `$set` when supplied — see the note in `upsertArticles()`.
   */
  summary?: string;

  contentType: ContentType;
  /** Which slots this article may fill. Precomputed so selection is a query, not a scan. */
  eligibleSlots: SlotId[];

  publishedAt: Date;
  updatedAt?: Date;
  ingestedAt: Date;

  /**
   * 0-100, copied down from this article's topic in `trend_features` so slot
   * queries can rank without a join. `trend_features` remains the source of
   * truth; this is a denormalized snapshot of the latest run.
   */
  trendScore?: number;

  /** Per-article traffic, when GA data is available. Topic rollups live in `trend_features`. */
  metrics?: ArticleMetrics;

  /** Set once the article ships in an issue, so later issues can skip it. */
  lastUsedInIssueId?: string;
  lastUsedAt?: Date;
}

export interface ArticleMetrics {
  views15m?: number;
  views1h?: number;
  views6h?: number;
  views24h?: number;
  users1h?: number;
  viewsVelocity1h?: number;
  viewsVelocity6h?: number;
  historicalCtr?: number;
  historicalEngagement?: number;
  shareRate?: number;
  commentRate?: number;
  collectedAt?: Date;
}

// ---------------------------------------------------------------------------
// topics
// ---------------------------------------------------------------------------

/** A developing story: the unit trends are scored against, not individual articles. */
export interface TopicDoc {
  _id: string;
  name: string;
  category: string;
  /** Normalized aliases that resolve here, e.g. "sona" and the Hindi spelling for gold. */
  aliases: string[];
  articleIds: string[];
  articleCount: number;
  firstSeenAt: Date;
  lastArticleAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// external_trends
// ---------------------------------------------------------------------------

/** A raw external signal reading. Append-only; `trend_features` derives from these. */
export interface ExternalTrendDoc {
  _id: string;
  topic: string;
  topicId?: string;
  keyword: string;
  source: ExternalTrendSource;
  /** 0-100, normalized by the fetcher. */
  trendScore: number;
  /** Ratio vs. the previous reading. 2.4 means searches at 2.4x the last sample. */
  searchGrowth?: number;
  rank?: number;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// trend_features
// ---------------------------------------------------------------------------

/**
 * The computed feature row for one topic at one point in time — the input the
 * selector actually ranks on. Append-only: each pipeline run writes a new row
 * so velocity and acceleration can be derived from the previous one.
 */
export interface TrendFeatureDoc {
  _id: string;
  topic: string;
  topicId?: string;

  views15m?: number;
  views1h?: number;
  views6h?: number;
  users1h?: number;

  /** Growth ratio of views1h vs. the previous run. 1.0 is flat. */
  velocity: number;
  /** Change in velocity between the last two runs. Positive means still speeding up. */
  acceleration: number;
  /** views1h against this topic's own rolling baseline. Above 1 is above its normal. */
  baselineRatio: number;

  /** 0-100 sub-scores. */
  engagementScore: number;
  externalTrendScore: number;
  recencyScore: number;

  /** 0-100 blend of the sub-scores. The number selection ranks on. */
  trendScore: number;
  status: TrendStatus;
  /** 0-100. How many inputs were present — a score off one signal is not trustworthy. */
  confidence: number;

  calculatedAt: Date;
}

// ---------------------------------------------------------------------------
// upcoming_events
// ---------------------------------------------------------------------------

/** Slot 5 inventory — the "what is coming next" hook. */
export interface UpcomingEventDoc {
  _id: string;
  title: string;
  description?: string;
  url?: string;
  eventDate: Date;
  category: string;

  /** 0-100 editorial judgement of how big this is. */
  importance: number;
  /** 0-100 from how this class of event performed historically. */
  historicalInterest?: number;
  /** 0-100 from live external trend signal. */
  currentSearchInterest?: number;

  eligibleSlot: SlotId;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// newsletter_issues
// ---------------------------------------------------------------------------

export type IssueStatus = 'draft' | 'ready' | 'sending' | 'sent' | 'failed';

/** Slots 1-4 hold an article, slot 5 holds an event. Both nullable — a slot can come up empty. */
export interface IssueSlot {
  articleId?: string;
  eventId?: string;
  theme: string;
  score?: number;
  reason?: string;
  /** Model-written Hindi one-liner, generated once per issue and replayed. */
  summary?: string;
}

/**
 * The single edition every subscriber receives. One per day, not one per user —
 * personalization would add a `segment` key here and make `_id`
 * `newsletter_<date>_<segment>`.
 */
export interface NewsletterIssueDoc {
  _id: string;
  date: string;
  status: IssueStatus;

  windowStart: Date;
  windowEnd: Date;

  topStory: IssueSlot | null;
  slots: Partial<Record<SlotId, IssueSlot>>;
  last24Hours: IssueSlot[];

  podcast?: {
    title: string;
    url: string;
    summary?: string;
  } | null;

  hook?: {
    type: 'poll';
    question: string;
    options: string[];
    basedOnArticleId: string;
  } | null;

  htmlContent?: string;
  subject?: string;

  /**
   * The snapshot's fingerprint — sha1 of `htmlContent` at the moment it was
   * sealed. Delivery sends the stored HTML, never a fresh render, so this is
   * what proves the mail that went out is the document still on file.
   */
  contentHash?: string;
  /**
   * Set when the rendered HTML was written. Its presence is what makes the
   * snapshot immutable: a regenerate refuses to overwrite a sealed issue that
   * is already `sending` or `sent`.
   */
  sealedAt?: Date;

  categoriesUsed: string[];
  /** Denormalized counters, updated as delivery progresses. */
  recipientCount: number;
  sentCount: number;
  failedCount: number;

  generatedAt: Date;
  sentAt?: Date;
}

// ---------------------------------------------------------------------------
// newsletter_recipients
// ---------------------------------------------------------------------------

export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'failed';

/**
 * One row per (issue, subscriber). Content is identical across rows — only the
 * recipient changes.
 *
 * This is also the send ledger: the unique `{newsletterId, email}` index makes
 * a re-run idempotent, so a cron that dies at subscriber 40,000 resumes from
 * the queued rows instead of re-mailing the first 40,000.
 */
export interface NewsletterRecipientDoc {
  _id: string;
  newsletterId: string;
  userId?: string;
  email: string;
  status: DeliveryStatus;
  /** Provider message id, for reconciling webhooks back to this row. */
  providerMessageId?: string;
  error?: string;
  attempts: number;
  queuedAt: Date;
  sentAt?: Date;
}

// ---------------------------------------------------------------------------
// newsletter_events
// ---------------------------------------------------------------------------

export type NewsletterEventType =
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'unsubscribed'
  | 'bounced'
  | 'complained';

/** Post-send engagement. Feeds `historicalCtr` back into the next run's scoring. */
export interface NewsletterEventDoc {
  _id: string;
  newsletterId: string;
  userId?: string;
  email: string;
  event: NewsletterEventType;
  /** Present on `clicked` — which story earned the click. */
  articleId?: string;
  slot?: SlotId | 'top_story' | 'podcast' | 'last_24h';
  url?: string;
  timestamp: Date;
}
