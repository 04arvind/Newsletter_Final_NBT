/**
 * The newsletter pipeline, end to end.
 *
 *     NBT / News Sources          ingest.ts
 *            |
 *     MongoDB Articles            ingest.ts   -> articles
 *            |
 *     Content Classification      ingest.ts   (at write time)
 *            |
 *     External Trend Signals      trend-engine.ts -> external_trends
 *            |
 *        TREND ENGINE             trend-engine.ts -> topics, trend_features
 *            |
 *        Trend Score              trend-engine.ts -> articles.trendScore
 *            |
 *     Candidate Articles          select.ts
 *            |
 *     Slot-Specific Filtering     select.ts
 *            |
 *     Ranking + Deduplication     select.ts
 *            |
 *     Newsletter Assembly         assemble.ts -> newsletter_issues
 *            |
 *      HTML Newsletter            assemble.ts
 *            |
 *     Email Service / ESP         deliver.ts  -> newsletter_recipients
 *            |
 *      All Subscribers            deliver.ts
 *
 * Every stage reads its input from MongoDB and writes its output back, so any
 * stage can be re-run on its own and the pipeline can resume from wherever it
 * stopped. The editorial window is resolved once, at the top, and threaded
 * through — otherwise a run spanning 06:00 would ingest against one window and
 * select against the next.
 */

import { getNewsletterWindow, type NewsletterWindow } from '../newsletter-window';
import { assembleIssue, type AssembleResult } from './assemble';
import { rankDailyTrends } from './daily-trend-ranking';
import { deliverIssue, type DeliverResult } from './deliver';
import { ingestArticles, type IngestResult } from './ingest';
import { selectIssue, type IssueSelection } from './select';
import { runTrendEngine, type TrendEngineResult } from './trend-engine';

export interface PipelineResult {
  date: string;
  windowStart: string;
  windowEnd: string;
  ingest: IngestResult;
  trends: TrendEngineResult;
  selection: {
    candidateCount: number;
    topStory: string | null;
    slotsFilled: string[];
    last24Hours: number;
  };
  issueId: string;
  summarized: number;
  delivery: DeliverResult | null;
  durationMs: number;
}

export interface PipelineOptions {
  /** Absolute origin used to build unsubscribe links. Required to deliver. */
  baseUrl?: string;
  /** Build the issue but do not mail it. The issue is still stored as `ready`. */
  skipDelivery?: boolean;
  /** Cap the emails one invocation sends, so a cron run stays in its budget. */
  maxToSend?: number;
  /** Skip the per-article metadata fetch. */
  skipMetadata?: boolean;
  window?: NewsletterWindow;
  now?: Date;
}

/**
 * Run every stage in order and return a report of what each one did.
 *
 * Delivery is skipped when no `baseUrl` is given: without it the unsubscribe
 * link in the mail would be broken, and a newsletter nobody can unsubscribe
 * from is worse than one that went out an hour late.
 */
export async function runNewsletterPipeline(
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const window = options.window || getNewsletterWindow(options.now);
  const now = options.now || new Date();

  // 1-3. sources -> articles -> classification
  const ingest = await ingestArticles(window);

  // 4-6. external signals -> trend engine -> trend score
  const trends = await runTrendEngine({ window, now });

  // Rank the window's trends over every snapshot of the last 24 hours, not just
  // this one, and hand that ranking to article selection via trendScore.
  await rankDailyTrends({ window, now });

  // 7-9. candidates -> slot filtering -> ranking + dedup
  const selection: IssueSelection = await selectIssue({ window, now });

  // 10-11. assembly -> HTML
  const assembled: AssembleResult = await assembleIssue({
    selection,
    window,
    skipMetadata: options.skipMetadata,
  });

  // 12-13. ESP -> subscribers
  let delivery: DeliverResult | null = null;
  if (!options.skipDelivery && options.baseUrl) {
    delivery = await deliverIssue({
      issueId: assembled.issue._id,
      baseUrl: options.baseUrl,
      maxToSend: options.maxToSend,
    });
  }

  const topStoryId = selection.topStory?.articleId;

  return {
    date: assembled.issue.date,
    windowStart: window.windowStartIso,
    windowEnd: window.windowEndIso,
    ingest,
    trends,
    selection: {
      candidateCount: selection.candidateCount,
      topStory: topStoryId
        ? selection.articlesById.get(topStoryId)?.title ?? topStoryId
        : null,
      slotsFilled: Object.keys(selection.slots).sort(),
      last24Hours: selection.last24Hours.length,
    },
    issueId: assembled.issue._id,
    summarized: assembled.summarized,
    delivery,
    durationMs: Date.now() - startedAt,
  };
}
