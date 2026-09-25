/**
 * Presentation rules shared by the two editions of the newsletter.
 *
 * `src/app/page.tsx` renders the web edition and `src/lib/email/` renders the
 * inbox edition, but both are the *same issue*: the same recap bullets, the
 * same date line, the same card artwork. These helpers used to live inside
 * `page.tsx`, where only the web edition could reach them — an email that
 * re-implemented `toSummaryLine` would drift from the site the first time a
 * clamp or a fallback changed.
 *
 * Nothing here fetches or renders. It is the mapping layer between the
 * `/api/trends/merge` payload and whatever is displaying it.
 */

import { sanitizeFallbackText } from './validation/newsletter-summary';

/** Stock artwork for cards whose article has no `og:image`. */
export const FALLBACK_CARD_IMAGES = [
  '/newsletter-assets/jai-zel.jpeg',
  '/newsletter-assets/estonia.jpeg',
  '/newsletter-assets/card3.avif',
  '/newsletter-assets/card4.avif',
  '/newsletter-assets/card5.avif',
];

/** The article fields the shared helpers below actually read. */
export interface PresentableArticle {
  title?: string;
  description?: string;
  newsletterSummary?: string;
}

/**
 * Rotates through the stock artwork by position, the way `.news-grid` does —
 * `index` is the card's position *within its own section*, so the two grids
 * start from the same image just as they do on the web.
 */
export function cardImageFor(image: string | undefined, index: number): string {
  return image || FALLBACK_CARD_IMAGES[index % FALLBACK_CARD_IMAGES.length];
}

/**
 * One "आज का न्यूज़ रीकैप" bullet.
 *
 * Ends on a real sentence boundary instead of appending an ellipsis. The old
 * version cut at 150 characters and tacked on "..." — and a valid 15-22 word
 * Devanagari bullet routinely runs past 150 characters, so finished sentences
 * were being truncated and shipped looking incomplete.
 */
export function toSummaryLine(article: PresentableArticle, maxLen = 150): string {
  const fallback = 'आज की महत्वपूर्ण खबर';

  const clamp = (value: string) => {
    if (value.length <= maxLen) return value;
    const cut = value.slice(0, maxLen);
    const lastStop = Math.max(
      cut.lastIndexOf('।'),
      cut.lastIndexOf('?'),
      cut.lastIndexOf('!')
    );
    if (lastStop > 0) return cut.slice(0, lastStop + 1).trim();
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}।`;
  };

  // The API already generated, validated and length-capped this bullet, so
  // render it verbatim. Re-clamping it here is what truncated complete
  // sentences; the local rewriting below is only for articles the recap
  // did not cover.
  if (article.newsletterSummary && article.newsletterSummary.trim()) {
    return article.newsletterSummary.trim();
  }

  // Scraped `og:description` reaches this path raw. Clean it before the
  // sentence split below, or JSON debris and byte markers from the source page
  // end up in the bullet.
  let text =
    sanitizeFallbackText(article.description) ||
    sanitizeFallbackText(article.title) ||
    fallback;

  if (article.title) {
    const title = String(article.title).trim();
    const overlapLen = Math.min(title.length, 40);
    if (
      overlapLen > 10 &&
      text.toLowerCase().startsWith(title.slice(0, overlapLen).toLowerCase())
    ) {
      text = text.slice(overlapLen).replace(/^[\s:|\-–]+/, '').trim();
    }
  }

  // Remove any remaining English headline label before a Hindi description.
  text = text
    .replace(/^[A-Za-z][A-Za-z0-9 &'()/,-]{1,100}\s*[:|\-–]\s*(?=[ऀ-ॿ])/, '')
    .trim();
  if (!/[ऀ-ॿ]/.test(text)) return fallback;

  const sentences = text.match(/[^।.!?]+[।.!?]/g) || [text];
  let summary = sentences[0].trim();
  if (summary.length < 30 && sentences[1]) {
    summary += ` ${sentences[1].trim()}`;
  }

  return clamp(summary);
}

/** The issue's date line, e.g. "17 सितंबर 2026". */
export function formatNewsletterDate(fetchedAt?: string): string {
  return new Intl.DateTimeFormat('hi-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(fetchedAt || Date.now()));
}
