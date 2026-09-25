import { NextResponse } from 'next/server';
import { fetchGoogleTrends } from '../../../../lib/fetch-google-trends';
import { fetchTwitterTrends } from '../../../../lib/fetch-twitter-trends';
import { deduplicateTrends, type RawTrend } from '../../../../lib/dedup';
import { rankTrends } from '../../../../lib/scoring';
import { getTopPodcastOfDay } from '../../../../lib/fetch-podcasts';
import { saveTopPodcast } from '../../../../lib/podcast-history-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [googleResult, twitterResult] = await Promise.allSettled([
      fetchGoogleTrends(),
      fetchTwitterTrends(),
    ]);
    const raw: RawTrend[] = [];
    if (googleResult.status === 'fulfilled') {
      raw.push(...googleResult.value.trends.map((trend) => ({
        keyword: trend.keyword,
        source: 'google' as const,
        fetchedAt: trend.fetchedAt,
      })));
    }
    if (twitterResult.status === 'fulfilled') {
      raw.push(...twitterResult.value.trends.map((trend) => ({
        keyword: trend.keyword,
        source: 'twitter' as const,
        fetchedAt: trend.fetchedAt,
      })));
    }
    const trends = rankTrends(deduplicateTrends(raw), [], 50);
    const podcast = await getTopPodcastOfDay(trends);
    await saveTopPodcast(podcast);
    return NextResponse.json({
      section: 'podcast',
      title: 'आज का खास पॉडकास्ट',
      podcast,
    });
  } catch (error) {
    console.error('Podcast API error:', error);
    return NextResponse.json(
      { section: 'podcast', title: 'आज का खास पॉडकास्ट', podcast: null },
      { status: 200 }
    );
  }
}