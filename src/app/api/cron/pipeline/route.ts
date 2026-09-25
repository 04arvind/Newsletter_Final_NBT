/**
 * The DB-backed newsletter pipeline, as one cron entry point.
 *
 * Supersedes `/api/cron/send-newsletter`, which runs the older in-memory path:
 * it calls `/api/trends/merge` over HTTP, composes from that response, and logs
 * to the legacy `issues` collection. Nothing there is persisted as articles,
 * topics or trend features, so there is no ledger to resume from and no
 * engagement to score the next run on. That route is left in place; point the
 * scheduler here when you are ready to switch.
 *
 *   GET  /api/cron/pipeline                 build and send
 *   GET  /api/cron/pipeline?dryRun=1        build only, store as `ready`
 *   GET  /api/cron/pipeline?maxToSend=500   send at most 500 this invocation
 *
 * Authenticated with the same `x-cron-secret` header as the existing cron.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInternalAppBaseUrl } from '../../../../lib/internal-base-url';
import { runNewsletterPipeline } from '../../../../lib/pipeline/run';

export const dynamic = 'force-dynamic';
/** The full pipeline fetches a sitemap, two trend sources and per-article metadata. */
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Refuse rather than run unauthenticated: this endpoint mails every subscriber.
  if (!secret) return false;
  return request.headers.get('x-cron-secret') === secret;
}

function positiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const dryRun = params.get('dryRun') === '1' || params.get('dryRun') === 'true';

  try {
    const result = await runNewsletterPipeline({
      baseUrl: getInternalAppBaseUrl(request),
      skipDelivery: dryRun,
      maxToSend: positiveInt(params.get('maxToSend')),
      skipMetadata: params.get('skipMetadata') === '1',
    });

    return NextResponse.json({ ok: true, dryRun, ...result });
  } catch (error) {
    console.error('newsletter pipeline failed', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Pipeline failed',
      },
      { status: 500 }
    );
  }
}
