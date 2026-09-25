/**
 * Per-recipient substitution of the `{{tokens}}` left in a stored issue.
 *
 * An issue is rendered once and stored once (`newsletter_issues.htmlContent`),
 * so the reader-specific parts of it cannot be baked in at render time. They
 * are left as the placeholders declared in `./newsletter-template.types`, and
 * this is the one place that fills them in, immediately before the mail goes
 * out. Nothing else in the HTML changes — the stored document and the sent
 * document differ only by these two values.
 *
 *   `{{subscriber_email}}`  sits in a query string (the footer's
 *                           subscribe/unsubscribe links), appears many
 *                           times, and must therefore be URL-encoded and
 *                           replaced globally.
 *   `{{unsubscribe_url}}`   is a whole URL. Present only when the issue was
 *                           rendered with `unsubscribeUrl: EMAIL_TOKENS
 *                           .UNSUBSCRIBE_URL`; the template otherwise builds a
 *                           working one-click link itself.
 */

import { EMAIL_TOKENS } from './newsletter-template.types';

export interface PersonalizeParams {
  /** The recipient's address, unencoded. */
  email: string;
  /** Absolute app origin, used to build the unsubscribe URL. */
  baseUrl: string;
}

export function personalizeIssueHtml(
  html: string,
  { email, baseUrl }: PersonalizeParams
): string {
  const encoded = encodeURIComponent(email);
  const unsubscribeUrl = `${baseUrl.replace(/\/+$/, '')}/api/unsubscribe?email=${encoded}`;

  // `split`/`join` rather than a regex: the tokens are literals, and this keeps
  // an address containing `$` from being read as a replacement pattern.
  return html
    .split(EMAIL_TOKENS.SUBSCRIBER)
    .join(encoded)
    .split(EMAIL_TOKENS.UNSUBSCRIBE_URL)
    .join(unsubscribeUrl);
}
