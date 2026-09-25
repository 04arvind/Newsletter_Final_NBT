import { Redis } from '@upstash/redis';
import type { Podcast } from './fetch-podcasts';

const WINNER_KEY = 'trend-engine:podcast:top-of-day';
const METRICS_KEY = 'trend-engine:podcast:metrics';
const MAX_METRICS = 240;

export interface PodcastMetricSnapshot {
  podcastId: string;
  timestamp: string;
  trendVelocity: number;
  topicPopularity: number;
  freshness: number;
  massAppeal: number;
  curiosity: number;
  newsImportance: number;
  newsletterFit: number;
  finalScore: number;
}

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
}

export async function saveTopPodcast(podcast: Podcast | null): Promise<void> {
  const redis = getRedis();
  if (!redis || !podcast) return;
  try {
    await redis.set(WINNER_KEY, podcast);
    const snapshot: PodcastMetricSnapshot = {
      podcastId: podcast.id,
      timestamp: new Date().toISOString(),
      trendVelocity: podcast.trendVelocity,
      topicPopularity: podcast.topicPopularity,
      freshness: podcast.freshness,
      massAppeal: podcast.massAppeal,
      curiosity: podcast.curiosity,
      newsImportance: podcast.newsImportance,
      newsletterFit: podcast.newsletterFit,
      finalScore: podcast.finalScore,
    };
    const previous = (await redis.get<PodcastMetricSnapshot[]>(METRICS_KEY)) || [];
    await redis.set(METRICS_KEY, [...previous, snapshot].slice(-MAX_METRICS));
  } catch (error) {
    console.warn('Podcast history save failed:', error);
  }
}

export async function loadTopPodcast(): Promise<Podcast | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get<Podcast>(WINNER_KEY);
  } catch (error) {
    console.warn('Podcast winner load failed:', error);
    return null;
  }
}
