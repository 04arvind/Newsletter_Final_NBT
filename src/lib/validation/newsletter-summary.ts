/**
 * Text hygiene for the "आज का न्यूज़ रीकैप" bullets.
 *
 * Two jobs, deliberately kept apart:
 *
 *  - `sanitizeArticleText()` cleans text going *into* OpenAI. Scraped
 *    `og:description` values arrive verbatim from `fetchArticleMetadata()` and
 *    routinely carry control characters, zero-width marks, stray JSON and
 *    markers like `_BYTES`. Left alone they break the prompt's article fences,
 *    which is how facts from one article end up in another's summary.
 *
 *  - `summaryRejection()` inspects text coming *out* of OpenAI (and the
 *    fallback text that stands in for it). It REJECTS rather than repairs: a
 *    bullet that needs repairing is a bullet we cannot vouch for, and the
 *    caller already has a safe degrade path. Silently patching corrupted text
 *    would hide the corruption instead of keeping it out of the newsletter.
 */

/** C0/C1 controls, minus the whitespace we normalize separately. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const CONTROL_CHARS_G = new RegExp(CONTROL_CHARS.source, 'g');

/** Zero-width joiners, bidi overrides and BOMs left behind by HTML scraping. */
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/;
const INVISIBLE_CHARS_G = new RegExp(INVISIBLE_CHARS.source, 'g');

/** U+FFFD — the tell-tale of a mis-decoded byte upstream. */
const REPLACEMENT_CHAR = /\uFFFD/;
const REPLACEMENT_CHAR_G = new RegExp(REPLACEMENT_CHAR.source, 'g');

/** Devanagari block. Every bullet must contain at least one of these. */
const DEVANAGARI = /[\u0900-\u097F]/;

/**
 * Scripts that have no business in a Hindi bullet. Latin is absent on purpose
 * — prompt rule 20 allows proper names, brands and abbreviations in English.
 */
const FOREIGN_SCRIPTS =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u3000-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

/**
 * Structural characters from a serialization format. A Hindi one-liner never
 * legitimately contains a brace or bracket, so their presence means a JSON
 * fragment (`"}],`, `},{`) leaked into the text.
 */
const JSON_FRAGMENT = /[{}[\]]/;

/** Straight and smart quotes: forbidden in a bullet, and JSON-fragment residue. */
const QUOTE_CHARS = /["'\u2018-\u201F]/;

/** A backslash never appears in Hindi prose; here it means an escape leaked. */
const ESCAPE_CHAR = /[\\]/;

/**
 * Byte/encoding markers such as `उत्तर_BYTES`, plus raw escape sequences and
 * undecoded HTML entities.
 */
const BYTE_MARKER = /_[A-Z][A-Z0-9_]{1,}\b|&#?\w{2,8};/;

/** Backticks, bold/heading markers and link syntax. */
const MARKDOWN = /`|\*\*|^#{1,6}\s|\]\(/m;

/** Any ellipsis, in either spelling. Prompt rule 9 forbids both. */
const ELLIPSIS = /\.{2,}|…/;

/** A finished sentence ends on one of these. */
const SENTENCE_END = /[।?!.]$/;

/**
 * Longest article text we hand the model per article. Long enough for a lead
 * paragraph, short enough that six of them cannot crowd out the output budget.
 */
const MAX_ARTICLE_CHARS = 1200;

/**
 * Normalizes one article's text for the prompt.
 *
 * Strips what should never have been there, collapses whitespace to single
 * spaces (newlines are what let scraped text imitate a prompt delimiter), and
 * caps the length. Returns '' when nothing usable survives.
 */
export function sanitizeArticleText(value: string | undefined | null): string {
  if (!value) return '';

  const cleaned = value
    .replace(CONTROL_CHARS_G, ' ')
    .replace(INVISIBLE_CHARS_G, '')
    .replace(REPLACEMENT_CHAR_G, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > MAX_ARTICLE_CHARS
    ? cleaned.slice(0, MAX_ARTICLE_CHARS).trimEnd()
    : cleaned;
}

/**
 * Why this text is unfit for the newsletter, or null when it is fine.
 *
 * The string is a short reason code meant for logs — it names the rule that
 * tripped so a bad batch can be diagnosed from the console alone.
 */
export function summaryRejection(value: string): string | null {
  const text = value.trim();

  if (!text) return 'empty';
  if (CONTROL_CHARS.test(text)) return 'control-characters';
  if (INVISIBLE_CHARS.test(text)) return 'invisible-characters';
  if (REPLACEMENT_CHAR.test(text)) return 'replacement-character';
  if (!DEVANAGARI.test(text)) return 'no-devanagari';
  if (FOREIGN_SCRIPTS.test(text)) return 'foreign-script';
  if (JSON_FRAGMENT.test(text)) return 'json-fragment';
  if (ESCAPE_CHAR.test(text)) return 'escape-sequence';
  if (BYTE_MARKER.test(text)) return 'byte-marker';
  if (MARKDOWN.test(text)) return 'markdown';
  if (ELLIPSIS.test(text)) return 'ellipsis-or-truncation';
  if (!SENTENCE_END.test(text)) return 'unterminated-sentence';

  return null;
}

/** Convenience predicate over `summaryRejection()`. */
export function isCleanSummary(value: string): boolean {
  return summaryRejection(value) === null;
}

/**
 * Everything that must never survive into a printed bullet, as one pass.
 * Built from the detectors above so the two can never drift apart.
 */
const FALLBACK_DEBRIS_G = new RegExp(
  [
    JSON_FRAGMENT.source,
    QUOTE_CHARS.source,
    ESCAPE_CHAR.source,
    BYTE_MARKER.source,
    MARKDOWN.source,
    FOREIGN_SCRIPTS.source,
    ELLIPSIS.source,
  ].join('|'),
  'gm'
);

/**
 * Best-effort cleanup for text that stands in for a generated summary.
 *
 * The fallback path prints a scraped `og:description` verbatim, so corruption
 * in the source reached readers without OpenAI being involved at all. Unlike
 * `summaryRejection()` this repairs instead of rejecting: an imperfect but real
 * sentence still beats an empty bullet, and there is nothing further to fall
 * back to. Returns '' when no readable Hindi survives, letting the caller drop
 * the bullet rather than print debris.
 */
export function sanitizeFallbackText(value: string | undefined | null): string {
  let text = sanitizeArticleText(value)
    .replace(FALLBACK_DEBRIS_G, ' ')
    .replace(/\s+/g, ' ')
    // Stripping debris strands the punctuation that surrounded it.
    .replace(/\s+([,;:.!?।])/g, '$1')
    .replace(/([,;:])\s*(?=[,;:])/g, '')
    .replace(/^[ ,;:|\u2013\u2014-]+/, '')
    .replace(/[ ,;:|\u2013\u2014-]+$/, '')
    .trim();

  if (!DEVANAGARI.test(text)) return '';

  // Removing a trailing ellipsis leaves a sentence with no ending. Fall back to
  // the last complete sentence, or close the one that is left - never print a
  // bullet that reads as cut off.
  if (!SENTENCE_END.test(text)) {
    const lastStop = Math.max(
      text.lastIndexOf('।'),
      text.lastIndexOf('?'),
      text.lastIndexOf('!')
    );
    text = lastStop > 20 ? text.slice(0, lastStop + 1) : `${text}।`;
  }

  return text;
}
