/**
 * Mail a stored issue.
 *
 *   POST /api/newsletter/issue/send                  today's stored issue
 *   POST /api/newsletter/issue/send?date=2026-09-17
 *   POST /api/newsletter/issue/send?id=newsletter_2026_09_17
 *   POST /api/newsletter/issue/send?maxToSend=1      stop after one address
 *   POST /api/newsletter/issue/send?retryFailed=1    re-queue failed rows first
 *   POST /api/newsletter/issue/send?generate=1       generate first, then send
 *
 * Only the stored HTML goes out — this route never renders. Without
 * `generate=1` an issue that was never generated is a 404, not a silent build:
 * what gets mailed is always a document that exists in the database first.
 *
 * Recipients come from `subscribers` when there are any, and from
 * `NEWSLETTER_TO` in `.env` when there are not. The response says which,
 * so a test send can never be mistaken for a real one.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { runDelivery, sendIssue } from '../../../../../lib/delivery';
import { assertDeliveryAuthorized, deliveryErrorPayload } from '../../../../../lib/delivery/http';
import { getInternalAppBaseUrl } from '../../../../../lib/internal-base-url';

export const dynamic = 'force-dynamic';
/** A generate-and-send in one call has to fetch the engine as well. */
export const maxDuration = 300;

function positiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function POST(request: NextRequest) {
  try {
    assertDeliveryAuthorized(request);

    const params = request.nextUrl.searchParams;
    const baseUrl = getInternalAppBaseUrl(request);
    const maxToSend = positiveInt(params.get('maxToSend'));

    if (params.get('generate') === '1') {
      const { generate, send } = await runDelivery({
        baseUrl,
        force: params.get('force') === '1',
        maxToSend,
      });
      return NextResponse.json({
        ok: true,
        generated: !generate.reused,
        contentHash: generate.contentHash,
        ...send,
      });
    }

    const result = await sendIssue({
      baseUrl,
      issueId: params.get('id') || undefined,
      date: params.get('date') || undefined,
      maxToSend,
      retryFailed: params.get('retryFailed') === '1',
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const { status, body } = deliveryErrorPayload(error);
    if (status >= 500) console.error('issue send failed', error);
    return NextResponse.json(body, { status });
  }
}
