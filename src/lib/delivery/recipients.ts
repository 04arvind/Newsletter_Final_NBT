/**
 * Who this issue goes to.
 *
 * There is no subscriber system yet — `subscribers` exists as a collection and
 * `/api/subscribe` writes to it, but in a local database it is empty. So the
 * resolution order is:
 *
 *   1. every `active` row in `subscribers`
 *   2. `NEWSLETTER_TO` from `.env`, the temporary test inbox
 *
 * In that order, deliberately. The day the first real subscriber exists, this
 * function starts returning the list and the test inbox stops being consulted
 * — no code change, no flag to remember to flip. Until then the same pipeline,
 * ledger and routes are exercised end to end against one address.
 *
 * `NEWSLETTER_TO` may hold several comma- or semicolon-separated addresses,
 * which is enough to test a batch without inventing a fake subscriber list.
 */

import { getSubscribersCollection } from '../db/client';
import { DeliveryError } from './errors';

export type RecipientSource = 'subscribers' | 'test';

export interface Recipient {
  email: string;
  userId?: string;
}

export interface ResolvedAudience {
  source: RecipientSource;
  recipients: Recipient[];
}

/** Deliberately permissive: this only rejects obvious junk before the provider does. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** `NEWSLETTER_TO` — one address, or several separated by `,` or `;`. */
export function testRecipients(): Recipient[] {
  const raw = process.env.NEWSLETTER_TO?.trim();
  if (!raw) return [];

  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const part of raw.split(/[,;]/)) {
    const email = part.trim().toLowerCase();
    if (!email || !looksLikeEmail(email) || seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email });
  }
  return recipients;
}

export async function activeSubscribers(): Promise<Recipient[]> {
  const subscribers = await getSubscribersCollection();
  const rows = await subscribers
    .find({ status: 'active' }, { projection: { email: 1 } })
    .toArray();
  return rows.map((row) => ({ email: row.email }));
}

/**
 * The audience for a send, with the source it came from so the caller can log
 * and report which one was used — a test run that silently mails 40,000 people,
 * or a production run that silently mails one developer, are both failures
 * worth making visible.
 */
export async function resolveAudience(): Promise<ResolvedAudience> {
  const subscribers = await activeSubscribers();
  if (subscribers.length > 0) {
    return { source: 'subscribers', recipients: subscribers };
  }

  const test = testRecipients();
  if (test.length > 0) {
    return { source: 'test', recipients: test };
  }

  throw new DeliveryError(
    'NO_RECIPIENTS',
    'No active subscribers, and NEWSLETTER_TO is unset or invalid in .env'
  );
}
