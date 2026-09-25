/**
 * One error type for the whole delivery pipeline.
 *
 * Every stage can fail for a reason the caller needs to tell apart — content
 * that never arrived, an issue that is already sent, a missing API key — and a
 * route has to turn that into an HTTP status. A bare `Error` would force the
 * routes to match on message strings, so the code and the status travel with
 * the error instead.
 */

export type DeliveryErrorCode =
  /** The engine, the render or a required section produced nothing usable. */
  | 'CONTENT_UNAVAILABLE'
  /** The issue exists but has already been sent, or is mid-send. */
  | 'ISSUE_SEALED'
  /** Asked to send an issue that was never generated. */
  | 'ISSUE_NOT_FOUND'
  /** The issue document carries no HTML, so there is nothing to mail. */
  | 'ISSUE_NOT_RENDERED'
  /** No subscribers and no `NEWSLETTER_TO` — nobody to send to. */
  | 'NO_RECIPIENTS'
  /** `RESEND_API_KEY` / `NEWSLETTER_FROM_EMAIL` missing, or the provider failed. */
  | 'PROVIDER_UNAVAILABLE'
  /** The request itself was wrong (bad date, unknown issue id, no secret). */
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED';

const STATUS_BY_CODE: Record<DeliveryErrorCode, number> = {
  CONTENT_UNAVAILABLE: 503,
  ISSUE_SEALED: 409,
  ISSUE_NOT_FOUND: 404,
  ISSUE_NOT_RENDERED: 409,
  NO_RECIPIENTS: 422,
  PROVIDER_UNAVAILABLE: 503,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
};

export class DeliveryError extends Error {
  readonly code: DeliveryErrorCode;
  readonly status: number;
  /** Anything the caller should see, e.g. which sections came up empty. */
  readonly details?: unknown;

  constructor(code: DeliveryErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DeliveryError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

/** Narrow an unknown catch value, so a route can answer 500 for everything else. */
export function isDeliveryError(error: unknown): error is DeliveryError {
  return error instanceof DeliveryError;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
