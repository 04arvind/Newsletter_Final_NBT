/**
 * Subscribe / unsubscribe links for the email footer.
 *
 * The web footer (`src/app/Footer.tsx`) can leave these inert — a reader is
 * already on the site and `MANAGE_SUBSCRIPTION_URL` is still `'#'`. An email
 * cannot: the footer links are the only way out of the list, and an
 * unsubscribe that does not unsubscribe is what gets a sender marked as spam.
 *
 * So both links are built here as real, absolute, one-click URLs against the
 * endpoints this project already has.
 *
 *   - Unsubscribe -> `GET /api/unsubscribe?email=…`, which
 *     `src/app/api/unsubscribe/route.ts` implements and documents as
 *     "one click unsubscribe link from emails". Working today, no new route.
 *
 *   - Subscribe -> `GET /api/subscribe?email=…`. A link click is always a GET,
 *     so `src/app/api/subscribe/route.ts` serves the same branch its `POST`
 *     handler runs over GET as well, the way the unsubscribe route already did.
 *
 * The address itself stays a `{{subscriber_email}}` placeholder so an issue can
 * be rendered and stored once, then personalised per recipient at send time.
 */

import { EMAIL_TOKENS } from './newsletter-template.types';

export const UNSUBSCRIBE_PATH = '/api/unsubscribe';
export const SUBSCRIBE_PATH = '/api/subscribe';

export interface SubscriptionUrlParams {
  /** Absolute app origin, e.g. `https://newsletter.example.com`. */
  baseUrl: string;
  /** Defaults to the `{{subscriber_email}}` delivery token. */
  subscriber?: string;
}

/** True for a `{{…}}` delivery placeholder rather than a real value. */
function isDeliveryToken(value: string): boolean {
  return /^\{\{[a-z0-9_]+\}\}$/i.test(value);
}

/**
 * A `{{token}}` is left verbatim — percent-encoding it would destroy the braces
 * the delivery layer searches for. The substituted address must therefore be
 * URL-encoded by the sender, exactly as `deliver.ts` already does when it fills
 * in `{{unsubscribe_url}}`.
 */
function encodeParam(value: string): string {
  return isDeliveryToken(value) ? value : encodeURIComponent(value);
}

function buildUrl(baseUrl: string, path: string, subscriber: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}?email=${encodeParam(subscriber)}`;
}

/**
 * One-click unsubscribe. Hits the existing `GET` handler in
 * `app/api/unsubscribe/route.ts`, which flips the subscriber's status and
 * stamps `unsubscribedAt`.
 */
export function buildUnsubscribeUrl({
  baseUrl,
  subscriber = EMAIL_TOKENS.SUBSCRIBER,
}: SubscriptionUrlParams): string {
  return buildUrl(baseUrl, UNSUBSCRIBE_PATH, subscriber);
}

/**
 * One-click (re)subscribe. Hits the `GET` handler in
 * `app/api/subscribe/route.ts`, which validates the address and then either
 * reports it as already active, clears `unsubscribedAt` to resubscribe it, or
 * inserts it.
 *
 * To send readers to a signup page instead, pass `footerLinks.subscribe` to
 * `renderNewsletterEmail` — an explicit value always wins over this default.
 */
export function buildSubscribeUrl({
  baseUrl,
  subscriber = EMAIL_TOKENS.SUBSCRIBER,
}: SubscriptionUrlParams): string {
  return buildUrl(baseUrl, SUBSCRIBE_PATH, subscriber);
}
