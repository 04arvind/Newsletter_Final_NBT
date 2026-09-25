/**
 * Stage 1 of delivery: build the issue and freeze it.
 *
 *     /api/trends/merge + /api/poll          (src/lib/email/newsletter-data.ts)
 *              |
 *     renderNewsletterEmail                  (src/lib/email/newsletter-template.ts)
 *              |
 *     validate — every required section present?
 *              |
 *     newsletter_issues.htmlContent          status: ready, sealedAt, contentHash
 *
 * Nothing here sends. That separation is the point: an issue is a stored
 * document first and a delivery second, so a failed fetch, an empty engine
 * response or a half-rendered template stops the pipeline *before* anything
 * reaches an inbox, and a send can be retried later without rebuilding — and
 * therefore without silently mailing a different set of articles than the one
 * that was reviewed.
 *
 * Content and rendering are not reimplemented here. `buildNewsletterEmail`
 * already fetches exactly what the web page fetches and renders it through the
 * existing template; this module only decides whether the result is fit to
 * store, and stores it.
 */

import { createHash } from 'crypto';
import { deriveArticleId } from '../db/article';
import {
  deriveIssueVersionId,
  findIssueByDate,
  issueDateFor,
  saveIssue,
} from '../db/newsletter';
import {
  SLOT_IDS,
  SLOT_THEMES,
  type IssueSlot,
  type NewsletterIssueDoc,
  type SlotId,
} from '../db/types';
import {
  canFillTemplate,
  renderNewsletterFromTemplate,
} from '../InternalTool/GenerateHTML/fill-template';
import { buildNewsletterEmail } from '../email/newsletter-data';
import type { EmailArticle, NewsletterEmailData } from '../email/newsletter-template.types';
import { getNewsletterWindow, type NewsletterWindow } from '../newsletter-window';
import { DeliveryError, errorMessage } from './errors';

export interface GenerateOptions {
  /** Absolute origin of this app — `getInternalAppBaseUrl(request)`. */
  baseUrl: string;
  /** Rebuild an already-generated issue. Refused once it is sending or sent. */
  force?: boolean;
  /** Editorial window. Defaults to the current one, as the pipeline does. */
  window?: NewsletterWindow;
  /**
   * Always build and store a new version under its own id, never reusing or
   * overwriting the day's issue. Used by the Internal Tool's Generate HTML.
   */
  newVersion?: boolean;
}

export interface GenerateResult {
  issue: NewsletterIssueDoc;
  /** True when an existing snapshot was returned instead of a fresh render. */
  reused: boolean;
  contentHash: string;
}

/** Sections an issue cannot go out without. */
function validate(data: NewsletterEmailData, html: string): void {
  const missing: string[] = [];
  if (!data.topStory?.title) missing.push('topStory');
  if (!data.recap?.length) missing.push('recap');
  if (!data.selectedNews?.length) missing.push('selectedNews');
  // A render that collapsed would still be a valid string, so check the
  // document actually carries the shell the template always emits.
  if (!html || !html.includes('<html')) missing.push('html');

  if (missing.length > 0) {
    throw new DeliveryError(
      'CONTENT_UNAVAILABLE',
      `Newsletter content incomplete — not generating. Missing: ${missing.join(', ')}`,
      { missing }
    );
  }
}

function contentHashOf(html: string): string {
  return createHash('sha1').update(html).digest('hex');
}

function toSlot(article: EmailArticle, theme: string, summary?: string): IssueSlot {
  return {
    // The same derivation `ingest` uses, so an issue built from the API path
    // still points at the article ids the DB path would have written.
    articleId: deriveArticleId(article.url),
    theme,
    summary,
  };
}

/**
 * Map the rendered issue back onto the stored document.
 *
 * The recap bullets are generated in reading order — the top story, then the
 * first five cards — so they line up with the slots by position.
 */
function toIssueShape(data: NewsletterEmailData) {
  const recap = data.recap ?? [];
  const selectedNews = data.selectedNews ?? [];

  const topStory = data.topStory
    ? toSlot(data.topStory, 'top_story', recap[0])
    : null;

  const slots: Partial<Record<SlotId, IssueSlot>> = {};
  selectedNews.slice(0, SLOT_IDS.length).forEach((article, index) => {
    const slotId = SLOT_IDS[index];
    slots[slotId] = toSlot(article, SLOT_THEMES[slotId], recap[index + 1]);
  });

  const last24Hours = (data.past24Hours ?? []).map((article) =>
    toSlot(article, 'last_24h')
  );

  const podcast = data.podcast
    ? { title: data.podcast.title, url: data.podcast.url }
    : null;

  const hook = data.poll
    ? {
        type: 'poll' as const,
        question: data.poll.question,
        options: data.poll.options,
        basedOnArticleId: topStory?.articleId || '',
      }
    : null;

  return { topStory, slots, last24Hours, podcast, hook };
}

/**
 * Fetch, render, validate and store today's issue.
 *
 * Idempotent by default: a second call returns the stored snapshot rather than
 * re-rendering, so hitting the generate route twice cannot quietly change what
 * a `ready` issue says. `force` rebuilds one that has not gone out yet.
 */
export async function generateIssue(options: GenerateOptions): Promise<GenerateResult> {
  const window = options.window || getNewsletterWindow();
  const date = issueDateFor(window.windowEnd);

  const existing = options.newVersion ? null : await findIssueByDate(date);
  if (existing && (existing.status === 'sending' || existing.status === 'sent')) {
    if (options.force) {
      throw new DeliveryError(
        'ISSUE_SEALED',
        `Issue ${existing._id} is ${existing.status} — its snapshot cannot be rebuilt`,
        { issueId: existing._id, status: existing.status }
      );
    }
    return {
      issue: existing,
      reused: true,
      contentHash: existing.contentHash || '',
    };
  }
  if (existing?.htmlContent && !options.force) {
    return {
      issue: existing,
      reused: true,
      contentHash: existing.contentHash || contentHashOf(existing.htmlContent),
    };
  }

  // --- fetch + render ------------------------------------------------------
  let rendered;
  try {
    rendered = await buildNewsletterEmail({
      baseUrl: options.baseUrl,
      windowEnd: window.windowEndIso,
    });
  } catch (error) {
    // The engine was unreachable, or the render threw. Either way there is no
    // issue to store and nothing to send.
    throw new DeliveryError(
      'CONTENT_UNAVAILABLE',
      `Could not build the newsletter: ${errorMessage(error)}`
    );
  }

  // The document that ships is `nbtNewsletter.html` populated with the data
  // that was just fetched. That template is the email renderer's own output
  // with the dynamic values cut out, so this changes nothing about the design
  // — it keeps the Internal Tool's preview, its download and the mail that
  // goes out as one artifact instead of two renders that could disagree.
  // An issue short of a section cannot be poured into a fixed template without
  // leaving an empty card behind, so those keep the renderer's own output. For
  // every issue the pipeline actually produces the two are byte-identical.
  const html = canFillTemplate(rendered.data)
    ? await renderNewsletterFromTemplate(rendered.data)
    : rendered.html;

  validate(rendered.data, html);

  // --- store ---------------------------------------------------------------
  const contentHash = contentHashOf(html);
  const shape = toIssueShape(rendered.data);

  const issue = await saveIssue({
    id: options.newVersion ? deriveIssueVersionId(date, window.windowEnd) : undefined,
    date,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    topStory: shape.topStory,
    slots: shape.slots,
    last24Hours: shape.last24Hours,
    podcast: shape.podcast,
    hook: shape.hook,
    htmlContent: html,
    subject: rendered.subject,
    contentHash,
    sealedAt: new Date(),
    status: 'ready',
  });

  return { issue, reused: false, contentHash };
}
