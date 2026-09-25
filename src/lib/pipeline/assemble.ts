/**
 * Pipeline stages 10-11: newsletter assembly -> HTML newsletter.
 *
 *     Newsletter Assembly
 *            |
 *      HTML Newsletter
 *
 * The issue is stored once in `newsletter_issues` and referenced by every
 * recipient row — the content is identical for all subscribers in Phase 1, so
 * copying the HTML per recipient would multiply a ~50KB document by the whole
 * subscriber list for no benefit.
 *
 * Two enrichment passes happen here, and only here, because both cost money or
 * latency per article and only the handful that made the issue are worth it:
 *
 *   - `fetchArticleMetadata` for the image and description (one HTTP request
 *     per article, so it runs over ~9 articles rather than the whole window).
 *   - `getNewsletterRecap` for the Hindi one-liners (one batched model call,
 *     falling back to the scraped description if OpenAI is unavailable).
 *
 * Both write back to `articles`, so a rebuild of the same issue reuses them
 * instead of paying again.
 */

import { markArticlesUsed, updateArticleEnrichment } from '../db/article';
import { saveIssue } from '../db/newsletter';
import type { IssueSlot, NewsletterIssueDoc, SlotId } from '../db/types';
import { composeNewsletter } from '../email/compose';
import { formatNewsletterDate } from '../newsletter-presentation';
import { fetchArticleMetadata } from '../article.metadata';
import { getNewsletterRecap, NEWSLETTER_RECAP_SIZE } from '../newsletter-summary';
import { issueDateFor } from '../db/newsletter';
import type { NewsletterWindow } from '../newsletter-window';
import type { IssueSelection } from './select';

export interface AssembleResult {
  issue: NewsletterIssueDoc;
  /** Articles whose summary came from the model rather than a fallback. */
  summarized: number;
  enrichedWithMetadata: number;
}

export interface AssembleOptions {
  selection: IssueSelection;
  window: NewsletterWindow;
  /** Optional — the flow diagram has no podcast stage, but the issue can carry one. */
  podcast?: NewsletterIssueDoc['podcast'];
  /** Skip the per-article metadata fetch (useful for a dry run). */
  skipMetadata?: boolean;
}

/** Slots in reading order: the top story leads, then slots 1-5. */
function orderedSlots(selection: IssueSelection): Array<{ slotId: SlotId | 'top_story'; slot: IssueSlot }> {
  const ordered: Array<{ slotId: SlotId | 'top_story'; slot: IssueSlot }> = [];
  if (selection.topStory) ordered.push({ slotId: 'top_story', slot: selection.topStory });
  for (const slotId of ['slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5'] as SlotId[]) {
    const slot = selection.slots[slotId];
    if (slot) ordered.push({ slotId, slot });
  }
  return ordered;
}

/**
 * Build the day's issue document and its HTML, and store both.
 *
 * The issue is saved with status `ready`, not `sent`: delivery is a separate
 * stage that can be retried without rebuilding, and the status is what stops a
 * half-finished issue from being mailed.
 */
export async function assembleIssue(options: AssembleOptions): Promise<AssembleResult> {
  const { selection, window } = options;
  const date = issueDateFor(window.windowEnd);

  // --- enrich the selected articles ---------------------------------------
  const selected = orderedSlots(selection);
  const articleEntries = selected
    .map((entry) => ({ entry, doc: entry.slot.articleId ? selection.articlesById.get(entry.slot.articleId) : undefined }))
    .filter((item): item is { entry: typeof selected[number]; doc: NonNullable<typeof item.doc> } => Boolean(item.doc));

  let enrichedWithMetadata = 0;
  if (!options.skipMetadata) {
    const metadata = await Promise.all(
      articleEntries.map(async (item) => {
        try {
          return await fetchArticleMetadata(item.doc.url);
        } catch {
          // A missing og:image is not worth failing the issue over.
          return {};
        }
      })
    );
    metadata.forEach((meta, index) => {
      const doc = articleEntries[index].doc;
      if (meta.description && !doc.description) doc.description = meta.description;
      if (meta.image && !doc.image) doc.image = meta.image;
      if (meta.description || meta.image) enrichedWithMetadata += 1;
    });
  }

  // --- summaries -----------------------------------------------------------
  // The recap helper caps at NEWSLETTER_RECAP_SIZE, which is exactly the top
  // story plus five slots; the last-24-hours list falls back to descriptions.
  const summarizable = articleEntries.slice(0, NEWSLETTER_RECAP_SIZE).map((item) => ({
    url: item.doc.url,
    title: item.doc.title,
    description: item.doc.description,
  }));
  const recap = await getNewsletterRecap(summarizable, `${date}:${window.windowEndIso}`);

  let summarized = 0;
  const summaryByArticleId = new Map<string, string>();
  recap.forEach((item, index) => {
    const doc = articleEntries[index]?.doc;
    if (!doc || !item.summary?.trim()) return;
    summaryByArticleId.set(doc._id, item.summary.trim());
    if (item.source === 'openai') summarized += 1;
  });

  // Persist enrichment so a rebuild of this issue does not pay for it again.
  await updateArticleEnrichment(
    articleEntries.map((item) => ({
      articleId: item.doc._id,
      summary: summaryByArticleId.get(item.doc._id),
    }))
  );

  // --- assemble the slots --------------------------------------------------
  const withSummary = (slot: IssueSlot): IssueSlot => ({
    ...slot,
    summary: slot.articleId ? summaryByArticleId.get(slot.articleId) : undefined,
  });

  const slots: Partial<Record<SlotId, IssueSlot>> = {};
  for (const [slotId, slot] of Object.entries(selection.slots) as Array<[SlotId, IssueSlot]>) {
    slots[slotId] = withSummary(slot);
  }
  const topStory = selection.topStory ? withSummary(selection.topStory) : null;
  const last24Hours = selection.last24Hours.map(withSummary);

  // --- render --------------------------------------------------------------
  const items = [...selected.map((entry) => entry.slot), ...last24Hours]
    .map((slot) => {
      if (slot.eventId && selection.event) {
        return {
          title: selection.event.title,
          summary: selection.event.description || slot.reason || '',
          url: selection.event.url || '',
          source: 'आने वाला कार्यक्रम',
        };
      }
      const doc = slot.articleId ? selection.articlesById.get(slot.articleId) : undefined;
      if (!doc) return null;
      return {
        title: doc.title,
        summary: summaryByArticleId.get(doc._id) || doc.description || '',
        url: doc.url,
        source: doc.source,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  // The issue stores an optional podcast summary; the renderer requires one.
  const featuredPodcast = options.podcast
    ? {
        title: options.podcast.title,
        url: options.podcast.url,
        summary: options.podcast.summary || '',
      }
    : null;

  // The mail carries the issue's own date, not the render's — a rebuild on the
  // next calendar day must not relabel yesterday's edition.
  const htmlContent = composeNewsletter({
    items,
    featuredPodcast,
    date: formatNewsletterDate(window.windowEndIso),
  });

  // --- store ---------------------------------------------------------------
  const issue = await saveIssue({
    date,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    topStory,
    slots,
    last24Hours,
    podcast: options.podcast ?? null,
    hook: selection.hook,
    htmlContent,
    subject: topStory && topStory.articleId
      ? selection.articlesById.get(topStory.articleId)?.title
      : `NBT न्यूजलेटर — ${date}`,
    categoriesUsed: selection.categoriesUsed,
    status: 'ready',
  });

  // Mark used only once the issue is safely stored, so a crash mid-assembly
  // does not burn the articles for tomorrow as well.
  await markArticlesUsed(selection.articleIds, issue._id);

  return { issue, summarized, enrichedWithMetadata };
}
