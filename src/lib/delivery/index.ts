/**
 * The newsletter delivery pipeline.
 *
 *     generateIssue()   fetch content -> render -> validate -> seal snapshot
 *            |          nothing is sent if any of that fails
 *     sendIssue()       resolve audience -> queue ledger -> provider
 *
 * Two stages, separately callable, because they fail differently: generation
 * fails because the content is not there, delivery fails because the transport
 * is not there, and a retry of one must not redo the other. The routes under
 * `src/app/api/newsletter/issue/` expose each stage on its own, plus this
 * module's `runDelivery` for the one-shot path a cron would use.
 *
 * Transport note: delivery currently goes through Resend, which is a temporary
 * arrangement for local testing only — see ./provider for what replacing it
 * involves (one file).
 */

export { DeliveryError, isDeliveryError, errorMessage } from './errors';
export type { DeliveryErrorCode } from './errors';

export { generateIssue } from './generate';
export type { GenerateOptions, GenerateResult } from './generate';

export { findIssueFor, sendIssue } from './send';
export type { SendOptions, SendResult } from './send';

export {
  activeSubscribers,
  resolveAudience,
  testRecipients,
} from './recipients';
export type { Recipient, RecipientSource, ResolvedAudience } from './recipients';

export {
  assertProviderConfigured,
  getDeliveryProvider,
  resendProvider,
} from './provider';
export type { DeliveryProvider, OutboundEmail } from './provider';

import { generateIssue, type GenerateResult } from './generate';
import { sendIssue, type SendResult } from './send';

export interface RunDeliveryOptions {
  baseUrl: string;
  /** Rebuild the issue even if one is already stored for today. */
  force?: boolean;
  /** Cap the emails this invocation sends. */
  maxToSend?: number;
  /** Build and store the issue, but do not mail it. */
  dryRun?: boolean;
}

export interface RunDeliveryResult {
  generate: GenerateResult;
  /** Null on a dry run, or when generation reused an already-sent issue. */
  send: SendResult | null;
}

/**
 * Generate then send, in one call.
 *
 * The order is the guarantee: `sendIssue` reads the snapshot back out of the
 * database rather than taking the HTML from `generateIssue`, so what is mailed
 * is by construction what was stored.
 */
export async function runDelivery(
  options: RunDeliveryOptions
): Promise<RunDeliveryResult> {
  const generate = await generateIssue({
    baseUrl: options.baseUrl,
    force: options.force,
  });

  if (options.dryRun) return { generate, send: null };

  const send = await sendIssue({
    baseUrl: options.baseUrl,
    issueId: generate.issue._id,
    maxToSend: options.maxToSend,
  });

  return { generate, send };
}
