/**
 * Intra-day trend snapshot collector.
 *
 * Schedule this through the day (hourly is plenty). Each call stores one trend
 * snapshot in `trend_features`; the 06:00 pipeline run ranks the day's trends
 * across all of them (`rankDailyTrends`) instead of trusting whatever is #1 at
 * 06:00.
 *
 *   GET  /api/cron/trends
 *
 * Authenticated with the same `x-cron-secret` header as the other crons.
 */

import { NextRequest, NextResponse } from 'next/server';
import { collectTrendSnapshot } from '../../../../lib/pipeline/daily-trend-ranking';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('x-cron-secret') === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { features, ...result } = await collectTrendSnapshot();
    return NextResponse.json({
      ok: true,
      ...result,
      topics: features.map((feature) => ({ topic: feature.topic, trendScore: feature.trendScore })),
    });
  } catch (error) {
    console.error('trend snapshot failed', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Trend snapshot failed' },
      { status: 500 }
    );
  }
}
