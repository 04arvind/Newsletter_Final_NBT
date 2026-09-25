/**
 * Pipeline stages 1-3: news sources -> MongoDB articles -> content classification.
 *
 *     NBT / News Sources
 *            |
 *     MongoDB Articles
 *            |
 *     Content Classification
 *
 * Classification is not a separate pass here on purpose. `upsertArticles()`
 * derives `category`, `contentType` and `eligibleSlots` at write time and stores
 * them, so downstream slot filling is an indexed query instead of a regex sweep
 * over the whole pool on every run. See `src/lib/content_classification/content.ts`.
 *
 * Article metadata (image, description) is deliberately *not* fetched here: that
 * is one HTTP request per article, and a 24-hour window carries hundreds. Only
 * the handful of articles that actually make the issue get enriched, in
 * `assemble.ts`.
 */

import { upsertArticles, type ArticleInput } from '../db/article';
import { fetchSitemap } from '../fetch-sitemap';
import { getNewsletterWindow, type NewsletterWindow } from '../newsletter-window';

export interface IngestResult {
  /** Articles the sitemap returned inside the editorial window. */
  fetched: number;
  upserted: number;
  modified: number;
  /** Rejected for a missing title/url or an unparseable publish date. */
  skipped: number;
  fetchedAt: string;
}

/**
 * Pull the current editorial window from the source sitemap and store it.
 *
 * Idempotent: re-running mid-window refreshes the articles already stored and
 * adds whatever has published since, without resetting `ingestedAt` or any
 * enrichment a later stage wrote.
 */
export async function ingestArticles(
  window: NewsletterWindow = getNewsletterWindow()
): Promise<IngestResult> {
  const sitemap = await fetchSitemap(window);

  const inputs: ArticleInput[] = sitemap.articles.map((article) => ({
    title: article.title,
    url: article.url,
    keywords: article.keywords,
    source: 'NBT',
    publishedAt: article.publishedAt,
  }));

  const result = await upsertArticles(inputs);

  return {
    fetched: sitemap.articles.length,
    upserted: result.upserted,
    modified: result.modified,
    skipped: result.skipped,
    fetchedAt: sitemap.fetchedAt,
  };
}
