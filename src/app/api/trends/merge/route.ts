
/**
 * Merge API — The Brain
 *
 * Orchestrates: fetch all sources → deduplicate → score → rank → respond
 * This is the single endpoint the dashboard calls.
 *
 * Calls source fetchers directly (no internal HTTP) to avoid
 * Vercel Deployment Protection 401 issues.
 */

import { NextResponse } from 'next/server';
import { deduplicateTrends, type RawTrend } from '../../../../lib/dedup';
import { rankTrends, type Article } from '../../../../lib/scoring';
import { fetchGoogleTrends } from '../../../../lib/fetch-google-trends';
import { fetchTwitterTrends } from '../../../../lib/fetch-twitter-trends';
import { fetchSitemap } from '../../../../lib/fetch-sitemap';
import { fetchArticleMetadata } from '../../../../lib/article.metadata';
import { getTopPodcastOfDay } from '../../../../lib/fetch-podcasts';
import { saveTopPodcast } from '../../../../lib/podcast-history-store';
import {
  getNewsletterWindow,
  getNewsletterWindowEndingAt,
  type NewsletterWindow,
} from '../../../../lib/newsletter-window';
import {
  selectPhase1Newsletter,
  type SelectionCandidate,
} from '../../../../lib/phase1-selection';
import {
  appendTrendSnapshot,
  loadTrendHistory,
  type TrendHistorySnapshot,
} from '../../../../lib/trend-history-store';
import {
  getNewsletterRecap,
  NEWSLETTER_RECAP_SIZE,
} from '../../../../lib/newsletter-summary';

export const dynamic = 'force-dynamic';

const DEFAULT_MERGE_CACHE_TTL_SECONDS = 300; // Cache lifetime, separate from the 24-hour editorial window

interface MergeCacheEntry {
  body: string;
  expiresAt: number;
}

const mergeCache = new Map<string, MergeCacheEntry>();
const mergeInFlight = new Map<string, Promise<NextResponse>>();

function mergeCacheTtlMs(): number {
  const seconds = Number.parseInt(
    process.env.MERGE_CACHE_TTL_SECONDS || String(DEFAULT_MERGE_CACHE_TTL_SECONDS),
    10
  );
  return Math.max(0, Number.isFinite(seconds) ? seconds : DEFAULT_MERGE_CACHE_TTL_SECONDS) * 1000;
}

function responseFromCache(entry: MergeCacheEntry, window: NewsletterWindow): NextResponse {
  const response = new NextResponse(entry.body, {
    headers: { 'Content-Type': 'application/json' },
  });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  response.headers.set('X-Merge-Cache', 'HIT');
  response.headers.set('X-Newsletter-Window-Start', window.windowStartIso);
  response.headers.set('X-Newsletter-Window-End', window.windowEndIso);
  return response;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // `?at=` pins the window to the moment Generate HTML was clicked.
  const at = new Date(params.get('at') || '');
  const window = Number.isFinite(at.getTime())
    ? getNewsletterWindowEndingAt(at)
    : getNewsletterWindow();
  const cacheKey = window.cacheKey;
  const forceRefresh = params.get('refresh') === '1';
  const now = Date.now();
  const cached = mergeCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return responseFromCache(cached, window);
  }

  const inFlight = mergeInFlight.get(cacheKey);
  if (inFlight) {
    return (await inFlight).clone();
  }

  const build = buildMergeResponse(window);
  mergeInFlight.set(cacheKey, build);
  try {
    const response = await build;
    if (response.ok) {
      const body = await response.clone().text();
      mergeCache.set(cacheKey, {
        body,
        expiresAt: Date.now() + mergeCacheTtlMs(),
      });
    }
    return response;
  } finally {
    mergeInFlight.delete(cacheKey);
  }
}

async function buildMergeResponse(window: NewsletterWindow) {
  try {
    const topN = parseInt(process.env.TOP_N || '10', 10);
    const maxArticlesOut = parseInt(
      process.env.MERGE_MAX_ARTICLES || '2000',
      10
    );

    // Fetch all sources directly (no self HTTP calls)
    const [sitemapResult, googleResult, twitterResult] = await Promise.allSettled([
      fetchSitemap(window),
      fetchGoogleTrends(),
      fetchTwitterTrends(),
    ]);

    let sitemapError: string | null = null;
    let articles: Article[] = [];
    if (sitemapResult.status === 'fulfilled') {
      articles = sitemapResult.value.articles as Article[];
    } else {
      sitemapError = sitemapResult.reason?.message || String(sitemapResult.reason);
    }

    let googleError: string | null = null;
    let googleTrends: RawTrend[] = [];
    if (googleResult.status === 'fulfilled') {
      googleTrends = googleResult.value.trends.map((t) => ({
        keyword: t.keyword,
        source: 'google' as const,
        fetchedAt: t.fetchedAt,
      }));
    } else {
      googleError = googleResult.reason?.message || String(googleResult.reason);
    }

    let twitterError: string | null = null;
    let twitterTrends: RawTrend[] = [];
    if (twitterResult.status === 'fulfilled') {
      twitterTrends = twitterResult.value.trends.map((t) => ({
        keyword: t.keyword,
        source: 'twitter' as const,
        fetchedAt: t.fetchedAt,
      }));
    } else {
      twitterError = twitterResult.reason?.message || String(twitterResult.reason);
    }

    const allTrends: RawTrend[] = [...googleTrends, ...twitterTrends];
    const uniqueTrends = deduplicateTrends(allTrends);
    const rankedTrends = rankTrends(uniqueTrends, articles, topN);

    const history: TrendHistorySnapshot[] = await loadTrendHistory();
    const lastSnapshot =
      history.length > 0 ? history[history.length - 1] : null;

    const trendsWithVelocity = rankedTrends.map((trend) => {
      if (!lastSnapshot) return { ...trend, velocity: 'new' as const };

      const prevTrend = (
        lastSnapshot.trends as Array<{
          normalizedKeyword?: string;
          rank?: number;
        }>
      ).find((t) => t.normalizedKeyword === trend.normalizedKeyword);

      if (!prevTrend || typeof prevTrend.rank !== 'number') {
        return { ...trend, velocity: 'new' as const };
      }

      const velocity = prevTrend.rank - trend.rank;
      return { ...trend, velocity };
    });

    const newSnapshot: TrendHistorySnapshot = {
      timestamp: new Date().toISOString(),
      trends: trendsWithVelocity,
    };
    await appendTrendSnapshot(newSnapshot, history);

    const podcast = await getTopPodcastOfDay(trendsWithVelocity);
    await saveTopPodcast(podcast);

    const totalGoogle = googleTrends.length;
    const totalTwitter = twitterTrends.length;
    const coveredCount = rankedTrends.filter((t) => t.isCovered).length;

    const articlesForClient = articles.slice(0, maxArticlesOut);

    const newsletterCandidateMap = new Map<string, SelectionCandidate>();
    for (const trend of rankedTrends) {
      for (const match of trend.matchedArticles) {
        const article = articles.find((item) => item.url === match.url);
        if (article && !newsletterCandidateMap.has(match.url)) {
          newsletterCandidateMap.set(match.url, {
            article,
            trendSignalScore: trend.score,
            trendKeyword: trend.keyword,
          });
        }
      }
    }
    const newsletterCandidates: SelectionCandidate[] = articles.map((article) => ({
      article,
      trendSignalScore: newsletterCandidateMap.get(article.url)?.trendSignalScore,
      trendKeyword: newsletterCandidateMap.get(article.url)?.trendKeyword,
    }));

    const selection = selectPhase1Newsletter(newsletterCandidates, window.windowEnd);
    const selectedForNewsletter = [
      selection.topStory,
      ...selection.todaysTop5,
      ...selection.last24Hours,
    ].filter((article): article is NonNullable<typeof selection.topStory> => article !== null);

    // Step 1: Fetch metadata for all articles in parallel (no model calls)
    const metadataEnriched = await Promise.all(
      selectedForNewsletter.map(async (article) => {
        const metadata = await fetchArticleMetadata(article.url);
        return { ...article, ...metadata };
      })
    );
    const metadataByUrl = new Map(metadataEnriched.map((article) => [article.url, article]));

    // Step 2: The recap section — exactly six articles, in reading order:
    // the top story, then today's five slots. Slot 5 (the upcoming-event slot)
    // is the one that can come up empty, so top the list back up to six from
    // the last-24-hours picks rather than shipping a short recap.
    const recapArticles = [
      selection.topStory,
      ...selection.todaysTop5,
      ...selection.last24Hours,
    ]
      .map((article) => (article ? metadataByUrl.get(article.url) : undefined))
      .filter((article): article is NonNullable<typeof article> => Boolean(article))
      .filter(
        (article, index, all) =>
          all.findIndex((other) => other.url === article.url) === index
      )
      .slice(0, NEWSLETTER_RECAP_SIZE);

    // Step 3: ONE batch OpenAI request for those six, generated once per
    // edition and replayed from storage on every later request.
    const recap = await getNewsletterRecap(
      recapArticles.map((article) => ({
        url: article.url,
        title: article.title,
        description: article.description,
      })),
      window.windowEndIso
    );

    // Step 4: Map each summary back onto its article by url, so the recap
    // bullets and the article cards agree.
    const recapByUrl = new Map(recap.map((item) => [item.url, item]));
    const enrichedArticles = metadataEnriched.map((merged) => ({
      ...merged,
      newsletterSummary: recapByUrl.get(merged.url)?.summary,
      summarySource: recapByUrl.get(merged.url)?.source,
    }));
    const enrichedByUrl = new Map(enrichedArticles.map((article) => [article.url, article]));
    const topStory = selection.topStory ? enrichedByUrl.get(selection.topStory.url) || null : null;
    const selectedNews = selection.todaysTop5
      .map((article) => enrichedByUrl.get(article.url))
      .filter((article): article is NonNullable<typeof topStory> => Boolean(article));
    const past24Hours = selection.last24Hours
      .map((article) => enrichedByUrl.get(article.url))
      .filter((article): article is NonNullable<typeof topStory> => Boolean(article));

    const response = NextResponse.json({
      trends: trendsWithVelocity,
      articles: articlesForClient,
      newsletter: {
        windowStart: window.windowStartIso,
        windowEnd: window.windowEndIso,
        topStory,
        podcast,
        // The six "आज का न्यूज़ रीकैप" bullets, already ordered by id so the
        // client renders each one at its article's position and never
        // summarizes anything itself.
        recap,
        selectedNews,
        past24Hours,
        upcomingEvents: selection.upcomingEvents,
        hook: selection.hook,
        phase1: {
          newsletter_date: new Date().toISOString().slice(0, 10),
          top_story: topStory
            ? {
              article_id: topStory.articleId || topStory.url,
              title: topStory.title,
              url: topStory.url,
              category: topStory.category,
              score: topStory.score,
              reason: topStory.reason,
            }
            : null,
          todays_top_5: selectedNews.map((article, index) => ({
            slot: article.slot || index + 1,
            slot_theme: article.slotTheme,
            article_id: article.articleId || article.url,
            title: article.title,
            url: article.url,
            category: article.category,
            score: article.score,
            reason: article.reason,
          })),
          upcoming_events: selection.upcomingEvents,
          last_24_hours: past24Hours.map((article, index) => ({
            rank: index + 1,
            article_id: article.articleId || article.url,
            title: article.title,
            url: article.url,
            category: article.category,
            score: article.score,
            reason: article.reason,
          })),
          hook: selection.hook
            ? {
              type: selection.hook.type,
              question: selection.hook.question,
              options: selection.hook.options,
              based_on_article_id: selection.hook.basedOnArticleId,
            }
            : null,
          selection_summary: {
            primary_objective: 'maximize views and subscriber growth',
            personalization: false,
            categories_used: selection.categoriesUsed,
            story_clusters_used: selection.storyClustersUsed,
            diversity_check: selection.categoriesUsed.length >= 3,
          },
        },
        selectionSummary: {
          primaryObjective: 'maximize views and subscriber growth',
          personalization: false,
          categoriesUsed: selection.categoriesUsed,
          storyClustersUsed: selection.storyClustersUsed,
          diversityCheck: selection.categoriesUsed.length >= 3,
        },
      },
      stats: {
        totalGoogleTrends: totalGoogle,
        totalTwitterTrends: totalTwitter,
        totalRawTrends: allTrends.length,
        uniqueAfterDedup: uniqueTrends.length,
        articlesScanned: articles.length,
        coveragePercent:
          rankedTrends.length > 0
            ? Math.round((coveredCount / rankedTrends.length) * 100)
            : 0,
        coveredCount,
        uncoveredCount: rankedTrends.length - coveredCount,
      },
      errors: {
        sitemap: sitemapError,
        google: googleError,
        twitter: twitterError,
      },
      fetchedAt: new Date().toISOString(),
    });
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    response.headers.set('X-Newsletter-Window-Start', window.windowStartIso);
    response.headers.set('X-Newsletter-Window-End', window.windowEndIso);
    return response;
  } catch (error) {
    console.error('Merge API error:', error);
    return NextResponse.json(
      { error: 'Failed to merge trends', details: String(error) },
      { status: 500 }
    );
  }
}