/**
 * Campaign tags for the newsletter's own links — the podcast link, the
 * "और खबरें देखें →" button, the masthead and footer logos, the social chips,
 * the store badges and the footer navigation links.
 *
 * Deliberately separate from `./article-utm`: that module owns the
 * "पूरी खबर पढ़ें →" link on each article and nothing here touches it. An
 * article click and a "follow us on Instagram" click are different events, and
 * keeping the two helpers apart is what stops a later change to one from
 * silently rewriting the other.
 *
 * What is left alone, and why:
 *
 *   - Anything that is not `http(s)` — a `{{delivery_token}}`, a `mailto:`, a
 *     relative asset path — is returned verbatim. Appending a query to a token
 *     would break the substitution the delivery layer performs.
 *   - The subscribe / unsubscribe links. They point at this app's own
 *     endpoints, carry the `{{subscriber_email}}` placeholder, and an
 *     unsubscribe is not a referral to NBT; tagging it as one would report
 *     list churn as campaign traffic.
 *   - Any parameter the URL already carries. Only the missing ones are added,
 *     so a URL that is already fully tagged comes back unchanged and nothing
 *     is ever duplicated.
 *
 * The existing path, query and `#fragment` are preserved exactly as given —
 * the URL is never re-encoded, only appended to. The result is returned
 * unescaped, like `withArticleUtm`, so callers escape it the same way they
 * already escaped the plain URL.
 */

/** The three tags, in the order they are appended. */
export const CAMPAIGN_UTM_PARAMS: ReadonlyArray<readonly [string, string]> = [
  ['utm_source', 'newsletter'],
  ['utm_medium', 'referral'],
  ['utm_campaign', 'morningnewsletter'],
];

/** The parameter names already present in `query`, whether or not they have a value. */
function parameterNames(query: string): Set<string> {
  const names = new Set<string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const equals = pair.indexOf('=');
    names.add(equals === -1 ? pair : pair.slice(0, equals));
  }
  return names;
}

/**
 * Appends whichever of {@link CAMPAIGN_UTM_PARAMS} `url` is missing, with `?`
 * when it has no query string yet and `&` when it does.
 */
export function withCampaignUtm(url: string | undefined): string {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url;

  const hash = url.indexOf('#');
  const link = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? '' : url.slice(hash);

  const queryStart = link.indexOf('?');
  const query = queryStart === -1 ? '' : link.slice(queryStart + 1);

  const present = parameterNames(query);
  const missing = CAMPAIGN_UTM_PARAMS.filter(([name]) => !present.has(name));
  if (missing.length === 0) return url;

  // `?a=1` needs `&`; `?` and `?a=1&` are already sitting on a separator.
  const separator =
    queryStart === -1 ? '?' : query === '' || query.endsWith('&') ? '' : '&';

  const appended = missing.map(([name, value]) => `${name}=${value}`).join('&');
  return `${link}${separator}${appended}${fragment}`;
}
