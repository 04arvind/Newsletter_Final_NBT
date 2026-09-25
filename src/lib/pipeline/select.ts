/**
 * Pipeline stages 7-9: candidate articles -> slot filtering -> ranking + dedup.
 *
 *     Candidate Articles
 *            |
 *     Slot-Specific Filtering
 *            |
 *     Ranking + Deduplication
 *
 * The candidate pool now comes out of MongoDB rather than a live sitemap fetch,
 * which is what makes the stage cheap and repeatable: the window is an indexed
 * range query, and articles already used in a recent issue are excluded in the
 * same query instead of being filtered out afterwards.
 *
 * Ranking and dedup themselves are `selectPhase1Newsletter()` — the existing
 * engine, unchanged. It already does slot-theme filtering, the two-per-category
 * cap, and story-key dedup so two write-ups of one story cannot take two slots.
 * This module's job is to feed it from the database and write its verdict back
 * in the issue's shape.
 *
 * Slot 5 is the exception. It needs something that has *not* happened yet, and
 * the article pool is almost entirely about things that already have, so when
 * no article qualifies the slot is filled from the `upcoming_events` inventory.
 */

import { findCandidates } from '../db/article';
import { findSlotEventCandidates } from '../db/event';
import { scoreEntertainmentTrends } from './trend-engine';
import type { ArticleDoc, IssueSlot, SlotId, UpcomingEventDoc } from '../db/types';
import { getNewsletterWindow, type NewsletterWindow } from '../newsletter-window';
import {
  selectPhase1Newsletter,
  type SelectedArticle,
  type SelectionCandidate,
  type SlotTheme,
} from '../phase1-selection';
import type { Article as ScoringArticle } from '../scoring';

/** Upper bound on the pool a single selection reads. */
const CANDIDATE_LIMIT = 1000;

/** Slot order matches `slotDefinitions` in phase1-selection.ts. */
const SLOT_BY_NUMBER: Record<number, SlotId> = {
  1: 'slot_1',
  2: 'slot_2',
  3: 'slot_3',
  4: 'slot_4',
  5: 'slot_5',
};

export interface IssueSelection {
  topStory: IssueSlot | null;
  slots: Partial<Record<SlotId, IssueSlot>>;
  last24Hours: IssueSlot[];
  categoriesUsed: string[];
  hook: {
    type: 'poll';
    question: string;
    options: string[];
    basedOnArticleId: string;
  } | null;
  /** Every article the issue references, for metadata enrichment and `markArticlesUsed`. */
  articleIds: string[];
  /** Kept so assembly can render titles/urls without re-reading Mongo. */
  articlesById: Map<string, ArticleDoc>;
  event: UpcomingEventDoc | null;
  candidateCount: number;
}

/** ArticleDoc -> the shape the selection engine scores. */
function toSelectionCandidate(
  doc: ArticleDoc,
  engagementTrendScores: Map<string, number>
): SelectionCandidate {
  const article: ScoringArticle = {
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
    // Articles of one developing story share a topicId, so the engine's
    // cluster dedup treats them as the same story.
    storyClusterId: doc.topicId,
    views1h: doc.metrics?.views1h,
    views6h: doc.metrics?.views6h,
    views24h: doc.metrics?.views24h,
    viewsVelocity1h: doc.metrics?.viewsVelocity1h,
    viewsVelocity6h: doc.metrics?.viewsVelocity6h,
    historicalCtr: doc.metrics?.historicalCtr,
    historicalEngagement: doc.metrics?.historicalEngagement,
    shareRate: doc.metrics?.shareRate,
    commentRate: doc.metrics?.commentRate,
  };

  return {
    article,
    // The topic trendScore computed in stage 6. When GA traffic is absent this
    // is the strongest interest signal the engine has.
    trendSignalScore: doc.trendScore,
    trendKeyword: doc.topic,
    // Computed at ingest and indexed. Keeps each slot to the articles actually
    // classified for it.
    eligibleSlots: doc.eligibleSlots,
    // Slot 3 only. Deliberately a separate field from `trendSignalScore`: that
    // one is normalized across every candidate, so feeding entertainment scores
    // into it would rescale the pool and shift slots 1, 2, 4 and 5.
    engagementTrendScore: engagementTrendScores.get(doc._id),
  };
}

function toIssueSlot(selected: SelectedArticle, theme: SlotTheme): IssueSlot {
  return {
    articleId: selected.articleId,
    theme,
    score: selected.score,
    reason: selected.reason,
  };
}

/**
 * Build the day's selection from what is stored.
 *
 * `excludeUsedSince` defaults to 3 days: long enough that a story cannot
 * reappear across consecutive issues, short enough that a genuinely developing
 * story can return once it has moved on.
 */
export async function selectIssue(options?: {
  window?: NewsletterWindow;
  excludeUsedWithinDays?: number;
  now?: Date;
}): Promise<IssueSelection> {
  const window = options?.window || getNewsletterWindow();
  const now = options?.now || new Date();
  const excludeDays = options?.excludeUsedWithinDays ?? 3;

  // --- 7. candidate articles ---------------------------------------------
  const candidates = await findCandidates({
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    excludeUsedSince: new Date(now.getTime() - excludeDays * 24 * 60 * 60 * 1000),
    limit: CANDIDATE_LIMIT,
  });

  const articlesById = new Map(candidates.map((doc) => [doc._id, doc]));

  // Slot 3's trending signal, over the slot-3 pool only. The external trend
  // sources carry no Hindi entertainment keywords, so this is derived from how
  // much coverage each story is getting — see `scoreEntertainmentTrends`.
  const engagementTrendScores = scoreEntertainmentTrends(
    candidates.filter((doc) => doc.eligibleSlots.includes('slot_3')),
    window.windowEnd
  );

  // --- 8 + 9. slot filtering, ranking, dedup ------------------------------
  const selection = selectPhase1Newsletter(
    candidates.map((doc) => toSelectionCandidate(doc, engagementTrendScores)),
    window.windowEnd
  );

  const slots: Partial<Record<SlotId, IssueSlot>> = {};
  for (const selected of selection.todaysTop5) {
    const slotId = SLOT_BY_NUMBER[selected.slot];
    if (slotId) slots[slotId] = toIssueSlot(selected, selected.slotTheme);
  }

  // Slot 5 falls back to the seeded event inventory when no article in the
  // window is about something still ahead of us.
  let event: UpcomingEventDoc | null = null;
  if (!slots.slot_5) {
    const [candidate] = await findSlotEventCandidates({ now, limit: 1 });
    if (candidate) {
      event = candidate;
      slots.slot_5 = {
        eventId: candidate._id,
        theme: 'big_upcoming_event',
        score: candidate.importance,
        reason: 'आने वाले बड़े और सत्यापित कार्यक्रम के लिए वापसी की वजह',
      };
    }
  }

  const topStory = selection.topStory
    ? toIssueSlot(selection.topStory, selection.topStory.slotTheme)
    : null;

  const last24Hours = selection.last24Hours.map((selected) =>
    toIssueSlot(selected, selected.slotTheme)
  );

  const articleIds = [
    ...new Set(
      [topStory, ...Object.values(slots), ...last24Hours]
        .map((slot) => slot?.articleId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  return {
    topStory,
    slots,
    last24Hours,
    categoriesUsed: selection.categoriesUsed,
    hook: selection.hook,
    articleIds,
    articlesById,
    event,
    candidateCount: candidates.length,
  };
}
