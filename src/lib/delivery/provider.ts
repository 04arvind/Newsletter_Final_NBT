/**
 * The seam between this pipeline and whatever actually puts mail on the wire.
 *
 * ---------------------------------------------------------------------------
 * RESEND IS TEMPORARY. It is here to make local testing possible — one API
 * key, one verified sender, no MTA — and is not the delivery solution for
 * production. Nothing above this file knows the provider's name: the pipeline
 * holds a `DeliveryProvider`, not a Resend client.
 *
 * To replace it: add a sibling module exporting a `DeliveryProvider`, and
 * return it from `getDeliveryProvider()` below. Everything else — the issue
 * snapshot, the recipient ledger, the retry and resume behaviour, the routes —
 * is provider-agnostic and stays as it is. `src/lib/email/send.ts` is then the
 * only other file to retire.
 * ---------------------------------------------------------------------------
 */

import { sendEmail } from '../email/send';
import { DeliveryError, errorMessage } from './errors';

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Already personalised — see `src/lib/email/personalize.ts`. */
  html: string;
}

export interface DeliveryProvider {
  /** Shown in logs and in the API responses, so a test run says where it went. */
  readonly name: string;
  /** Resolves with the provider's message id when it accepted the mail. */
  sendOne(email: OutboundEmail): Promise<{ id?: string }>;
}

/**
 * Wraps the existing Resend binding in `src/lib/email/send.ts` rather than
 * constructing a second client: that module already reads `RESEND_API_KEY`
 * lazily (so `next build` does not crash when the key is absent) and already
 * sends from `NEWSLETTER_FROM_EMAIL`.
 */
export const resendProvider: DeliveryProvider = {
  name: 'resend',
  async sendOne({ to, subject, html }) {
    const data = await sendEmail({ to, subject, html });
    return { id: data?.id };
  },
};

/**
 * Fails loudly and early when the environment cannot send at all, so a send
 * request is refused before the issue is moved to `sending` and 500 recipients
 * are queued against a key that does not exist.
 */
export function assertProviderConfigured(): void {
  const missing = ['RESEND_API_KEY', 'NEWSLETTER_FROM_EMAIL'].filter(
    (name) => !process.env[name]?.trim()
  );
  if (missing.length > 0) {
    throw new DeliveryError(
      'PROVIDER_UNAVAILABLE',
      `Email provider is not configured: ${missing.join(', ')} missing from .env`,
      { missing }
    );
  }
}

export function getDeliveryProvider(): DeliveryProvider {
  return resendProvider;
}

/** Normalises a provider failure into the pipeline's error type. */
export function toProviderError(error: unknown): DeliveryError {
  return new DeliveryError('PROVIDER_UNAVAILABLE', errorMessage(error));
}
