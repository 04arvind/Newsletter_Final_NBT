/**
 * Build today's issue and store it. Sends nothing.
 *
 *   POST /api/newsletter/issue/generate            build, or return the stored one
 *   POST /api/newsletter/issue/generate?force=1    rebuild (refused once sending/sent)
 *
 * Idempotent on purpose: calling it twice returns the same snapshot, so the
 * document a reviewer previewed is the document that later gets mailed.
 *
 * Authenticated with the same `x-cron-secret` header as the cron routes; with
 * no `CRON_SECRET` set it is open in development only, for local testing.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { generateIssue } from '../../../../../lib/delivery';
import { assertDeliveryAuthorized, deliveryErrorPayload } from '../../../../../lib/delivery/http';
import { getInternalAppBaseUrl } from '../../../../../lib/internal-base-url';

export const dynamic = 'force-dynamic';
/** The engine fetch behind a fresh build is the slow part, not the render. */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    assertDeliveryAuthorized(request);

    const force = request.nextUrl.searchParams.get('force') === '1';
    const { issue, reused, contentHash } = await generateIssue({
      baseUrl: getInternalAppBaseUrl(request),
      force,
    });

    return NextResponse.json({
      ok: true,
      reused,
      issue: {
        id: issue._id,
        date: issue.date,
        status: issue.status,
        subject: issue.subject,
        contentHash,
        sealedAt: issue.sealedAt,
        htmlBytes: issue.htmlContent?.length ?? 0,
        recipientCount: issue.recipientCount,
        sentCount: issue.sentCount,
        failedCount: issue.failedCount,
      },
      preview: `/api/newsletter/issue/preview?id=${encodeURIComponent(issue._id)}`,
    });
  } catch (error) {
    const { status, body } = deliveryErrorPayload(error);
    if (status >= 500) console.error('issue generate failed', error);
    return NextResponse.json(body, { status });
  }
}
