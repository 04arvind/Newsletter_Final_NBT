/**
 * HMAC token for the one-click unsubscribe link.
 *
 * The footer link carries `?email=…&token=…`; the token is an HMAC-SHA256 of
 * the (lowercased) address keyed with `UNSUB_SECRET`, so a link can only
 * unsubscribe the address it was minted for. Server-only — it reads the secret.
 */

import { createHmac, timingSafeEqual } from 'crypto';

function getSecret(): string {
  const secret = process.env.UNSUB_SECRET;
  if (!secret) {
    throw new Error('UNSUB_SECRET is not set. Add it to your .env file (see .env.example).');
  }
  return secret;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Hex HMAC-SHA256 of the address. */
export function createUnsubscribeToken(email: string): string {
  return createHmac('sha256', getSecret()).update(normalizeEmail(email)).digest('hex');
}

/** Timing-safe check that `token` was minted for `email`. */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = Buffer.from(createUnsubscribeToken(email), 'hex');
  const given = Buffer.from(token, 'hex');
  // `timingSafeEqual` throws on a length mismatch, and a malformed hex string
  // decodes short — both are simply an invalid token.
  return given.length === expected.length && timingSafeEqual(given, expected);
}
