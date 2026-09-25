import {
  generateNewsletterSummary,
  generateBatchNewsletterSummaries,
  BATCH_PROMPT_VERSION,
} from "../summarizer/model.summarizer";

import type { BatchArticleInput } from "../summarizer/model.summarizer";

import {
  sanitizeArticleText,
  sanitizeFallbackText,
} from "./validation/newsletter-summary";

import {
  loadStoredRecap,
  saveStoredRecap,
  type RecapSummary,
} from "./newsletter-recap-store";

/**
 * Server-side wrapper around the OpenAI summarizer used for the
 * "आज का न्यूज़ रीकैप" bullets.
 *
 * Why this exists:
 * - `generateNewsletterSummary` / `generateBatchNewsletterSummaries` are the
 *   raw model calls; they throw. Everything reader-facing needs a graceful
 *   degrade path, which is what this layer adds.
 * - The frontend used to build these bullets itself with a regex
 *   sentence-splitter over the raw scraped `og:description`. It no longer
 *   does — the bullets are model-generated here, once, and shipped with the
 *   newsletter payload.
 */

interface CacheEntry {
  summary: string;
  expiresAt: number;
}

const summaryCache = new Map<string, CacheEntry>();

function cacheTtlMs(): number {
  const ms = Number.parseInt(process.env.SUMMARY_CACHE_TTL_MS || '', 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 6 * 60 * 60 * 1000; // 6h default
}

function cacheKey(url: string, title: string): string {
  return `${url}::${title}`;
}

export interface SummarizableArticle {
  url: string;
  title: string;
  description?: string;
}

/** The recap section carries exactly this many articles. */
export const NEWSLETTER_RECAP_SIZE = 6;

/**
 * Budget for the whole batch call, which can now be two requests deep: the
 * first pass, then one strict-Hindi retry of whichever articles it rejected
 * (those retries run in parallel with each other). Sized at 30s the timeout
 * could fire mid-retry and drop every bullet to fallback text — losing the
 * clean ones too — so the default leaves room for the second round.
 */
function recapBatchTimeoutMs(): number {
  const ms = Number.parseInt(process.env.OPENAI_BATCH_TIMEOUT_MS || '', 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 45_000;
}

/**
 * Stand-in text when OpenAI is unavailable, errors, times out, or returns
 * something unusable.
 *
 * The scraped `og:description` is cleaned first: `fetchArticleMetadata()`
 * returns whatever the page's meta tag held, and that is where corrupted
 * bullets came from on every build that took this path. Falls through to the
 * title when the description cleans down to nothing.
 */
function fallbackSummary(article: SummarizableArticle): string {
  return (
    sanitizeFallbackText(article.description) ||
    sanitizeFallbackText(article.title) ||
    ''
  );
}

function articleText(article: SummarizableArticle): string {
  // Sanitized again inside the summarizer; cleaned here too so the cache key
  // and the text actually sent to OpenAI describe the same article.
  return [
    sanitizeArticleText(article.title),
    sanitizeArticleText(article.description),
  ]
    .filter(Boolean)
    .join('. ');
}

/**
 * Returns an OpenAI-generated Hindi one-liner for a single article.
 * Falls back to the raw scraped description (never the old regex mangler)
 * if OpenAI is unavailable, errors, or times out, so a bad API call
 * degrades gracefully instead of breaking the newsletter render.
 */
export async function getNewsletterSummary(
  article: SummarizableArticle
): Promise<{ summary: string; source: 'openai' | 'fallback' }> {
  const key = cacheKey(article.url, article.title);
  const now = Date.now();
  const cached = summaryCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { summary: cached.summary, source: 'openai' };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { summary: fallbackSummary(article), source: 'fallback' };
  }

  try {
    const summary = await Promise.race([
      generateNewsletterSummary(articleText(article)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OpenAI summary timed out')), 8000)
      ),
    ]);

    summaryCache.set(key, { summary, expiresAt: now + cacheTtlMs() });
    return { summary, source: 'openai' };
  } catch (error) {
    console.error('OpenAI summary failed, falling back:', error);
    return { summary: fallbackSummary(article), source: 'fallback' };
  }
}

// ---------------------------------------------------------------------------
// Recap — ONE OpenAI request per newsletter edition
// ---------------------------------------------------------------------------

/**
 * Builds the six "आज का न्यूज़ रीकैप" bullets for one newsletter edition.
 *
 * Flow:
 *   1. Load the recap already stored for `editionKey`, if any.
 *   2. Anything not already summarized goes out in a **single** batch
 *      request — on a first build that is all six articles at once.
 *   3. Persist the result against the edition so every later render (a
 *      reader refresh, a merge-cache expiry, a cold instance) replays it
 *      instead of calling OpenAI again.
 *
 * Ids are list positions, so the returned array is in the same order as the
 * articles that came in and each summary lands at its own article's slot.
 * Falls back to `description ?? title` per article on any failure, and those
 * fallbacks are never treated as generated, so a later build retries them.
 */
export async function getNewsletterRecap(
  articles: SummarizableArticle[],
  editionKey: string
): Promise<RecapSummary[]> {
  const recapArticles = articles.slice(0, NEWSLETTER_RECAP_SIZE);
  if (!recapArticles.length) return [];

  const stored = await loadStoredRecap(editionKey);

  // Only model-generated bullets count as done — a stored fallback means the
  // previous build failed, and that article deserves another attempt.
  const storedByUrl = new Map(
    (stored?.items ?? [])
      .filter((item) => item.source === 'openai' && item.summary.trim())
      .map((item) => [item.url, item])
  );

  const results: RecapSummary[] = new Array(recapArticles.length);
  const pending: number[] = [];

  for (let i = 0; i < recapArticles.length; i++) {
    const article = recapArticles[i];
    const previous = storedByUrl.get(article.url);

    if (previous) {
      // Reuse the stored text, but re-anchor id/title to this build's slot.
      results[i] = { ...previous, id: i, title: article.title };
    } else {
      pending.push(i);
    }
  }

  console.log(
    `[Recap] edition=${editionKey} prompt=v${BATCH_PROMPT_VERSION} — ` +
    `${recapArticles.length} article(s), ` +
    `${recapArticles.length - pending.length} reused, ${pending.length} to summarize`
  );

  if (!pending.length) {
    console.log('[Recap] Served entirely from the stored recap — 0 OpenAI requests');
    return results;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[Recap] OPENAI_API_KEY not set — using fallback text for all');
    for (const index of pending) {
      const article = recapArticles[index];
      results[index] = {
        id: index,
        url: article.url,
        title: article.title,
        summary: fallbackSummary(article),
        source: 'fallback',
      };
    }
    return results;
  }

  try {
    // ONE request for every article still missing a summary.
    const batchInputs: BatchArticleInput[] = pending.map((index) => ({
      id: index,
      article: articleText(recapArticles[index]),
    }));

    const summaries = await Promise.race([
      generateBatchNewsletterSummaries(batchInputs),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('OpenAI batch summary timed out')),
          recapBatchTimeoutMs()
        )
      ),
    ]);

    // Map each summary back onto its article by the id it was sent with.
    const summaryById = new Map(summaries.map((item) => [item.id, item.summary]));

    for (const index of pending) {
      const article = recapArticles[index];
      const generated = summaryById.get(index)?.trim();

      if (!generated) {
        console.warn(`[Recap] Missing summary for id=${index}, falling back`);
      }

      results[index] = {
        id: index,
        url: article.url,
        title: article.title,
        summary: generated || fallbackSummary(article),
        source: generated ? 'openai' : 'fallback',
      };
    }

    await saveStoredRecap({
      editionKey,
      generatedAt: new Date().toISOString(),
      items: results,
    });

    console.log(
      `[Recap] Generated ${summaryById.size} summary(ies) in 1 OpenAI request and stored them`
    );
  } catch (error) {
    // Graceful degrade: show the scraped description rather than nothing.
    // Nothing is stored, so the next build retries instead of freezing this in.
    console.error('[Recap] Batch OpenAI request failed, falling back:', error);
    for (const index of pending) {
      const article = recapArticles[index];
      results[index] = {
        id: index,
        url: article.url,
        title: article.title,
        summary: fallbackSummary(article),
        source: 'fallback',
      };
    }
  }

  return results;
}
