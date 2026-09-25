/**
 * Campaign tags for the links that open an article.
 *
 * Two per article carry them: the "पूरी खबर पढ़ें →" call to action and the
 * artwork above it, which opens the same story. The headline between them is
 * deliberately left untagged, so one story cannot report three separate visits
 * from a reader who only ever landed on it once.
 *
 * Everything that is not an article — the podcast link, the store badges, the
 * social chips, the footer navigation — is tagged by `./campaign-utm` instead.
 *
 * The article URL itself is never rewritten: whatever path and query
 * `item.url` / `article.url` already carry is kept verbatim and the three
 * parameters are appended after it — with `&` when the URL already has a query
 * string, with `?` when it does not. A `#fragment` stays at the end, where a
 * URL requires it to be.
 */

/** `?utm_source=newsletter&utm_medium=referral&utm_campaign=morningnewsletter`. */
export const ARTICLE_UTM_QUERY =
  'utm_source=newsletter&utm_medium=referral&utm_campaign=morningnewsletter';

/**
 * Appends {@link ARTICLE_UTM_QUERY} to `url`, unescaped — callers pass the raw
 * URL and escape the result the same way they already escaped the plain one.
 */
export function withArticleUtm(url: string | undefined): string {
  if (!url) return '';

  const hash = url.indexOf('#');
  const link = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? '' : url.slice(hash);
  const separator = link.includes('?') ? '&' : '?';

  return `${link}${separator}${ARTICLE_UTM_QUERY}${fragment}`;
}
