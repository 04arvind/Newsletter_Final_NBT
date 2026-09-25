/**
 * The bits the delivery routes share: who may call them, and how a failure is
 * reported.
 *
 * Kept free of `next/server` so the delivery layer stays testable on its own —
 * the routes turn these values into a `NextResponse`.
 */

import { DeliveryError, errorMessage, isDeliveryError } from './errors';

/**
 * Same `x-cron-secret` header the existing cron routes use.
 *
 * When `CRON_SECRET` is unset the guard opens up in development only, so these
 * endpoints can be driven from Postman on a local machine without inventing a
 * secret first. In production an unset secret is a refusal, not a bypass —
 * `/api/newsletter/issue/send` mails people.
 */
export function assertDeliveryAuthorized(request: Request): void {
  const secret = process.env.CRON_SECRET?.trim();

  if (secret) {
    if (request.headers.get('x-cron-secret') !== secret) {
      throw new DeliveryError('UNAUTHORIZED', 'Invalid or missing x-cron-secret header');
    }
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new DeliveryError(
      'UNAUTHORIZED',
      'CRON_SECRET is not set — refusing to expose the delivery routes in production'
    );
  }
}

export interface DeliveryErrorPayload {
  status: number;
  body: { ok: false; code: string; error: string; details?: unknown };
}

/** Maps a thrown value onto an HTTP status and a stable JSON error shape. */
export function deliveryErrorPayload(error: unknown): DeliveryErrorPayload {
  if (isDeliveryError(error)) {
    return {
      status: error.status,
      body: {
        ok: false,
        code: error.code,
        error: error.message,
        details: error.details,
      },
    };
  }

  return {
    status: 500,
    body: { ok: false, code: 'INTERNAL', error: errorMessage(error) },
  };
}
