/**
 * Persistence for the "आज का न्यूज़ रीकैप" bullets.
 *
 * The recap is generated exactly once per newsletter edition — one OpenAI
 * batch request for all six articles — and then replayed from here on every
 * later render. Without this, the merge cache expiring (MERGE_CACHE_TTL_SECONDS,
 * 5 minutes by default) or a cold serverless instance would re-summarize the
 * same six articles, so a reader hitting refresh would silently bill another
 * OpenAI call.
 *
 * Storage mirrors `trend-history-store.ts`: Upstash Redis when
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are configured, and an
 * in-memory map otherwise so a single-process dev server or a deployment
 * without Redis still generates the recap only once.
 */

import { Redis } from '@upstash/redis';

import { BATCH_PROMPT_VERSION } from '../summarizer/model.summarizer';

const KEY_PREFIX = 'trend-engine:newsletter:recap';

/** Two editions of headroom — the window rolls at 06:00 IST every day. */
const TTL_SECONDS = 48 * 60 * 60;

export interface RecapSummary {
  /** Position in the recap list, and the id sent to / returned by OpenAI. */
  id: number;
  url: string;
  title: string;
  summary: string;
  source: 'openai' | 'fallback';
}

export interface StoredRecap {
  /** Newsletter edition this recap belongs to (the window end ISO stamp). */
  editionKey: string;
  generatedAt: string;
  items: RecapSummary[];
}

const globalForRecap = globalThis as unknown as {
  __newsletterRecapCache?: Map<string, StoredRecap>;
};

// Pinned to globalThis in dev so HMR reloads don't drop the recap and trigger
// a fresh OpenAI batch on the next save.
const memoryCache: Map<string, StoredRecap> =
  globalForRecap.__newsletterRecapCache ?? new Map<string, StoredRecap>();
if (process.env.NODE_ENV !== 'production') {
  globalForRecap.__newsletterRecapCache = memoryCache;
}

/**
 * Storage key for one edition's recap.
 *
 * The prompt/model fingerprint sits in the key rather than inside the value,
 * so a reworded prompt simply looks up a key that does not exist yet and
 * regenerates. Summaries written under the previous wording are never read
 * again and expire on their own TTL — no manual clearing, and no edition that
 * silently serves the old style until the window rolls.
 */
function storageKey(editionKey: string): string {
  return `${KEY_PREFIX}:v${BATCH_PROMPT_VERSION}:${editionKey}`;
}

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
}

/**
 * The recap stored for this edition under the current prompt, or null when it
 * has not been generated yet — which is also what a prompt edit produces.
 */
export async function loadStoredRecap(editionKey: string): Promise<StoredRecap | null> {
  const key = storageKey(editionKey);

  const inMemory = memoryCache.get(key);
  if (inMemory) return inMemory;

  const redis = getRedis();
  if (!redis) return null;

  try {
    const stored = await redis.get<StoredRecap>(key);
    if (!stored || !Array.isArray(stored.items)) return null;
    memoryCache.set(key, stored);
    return stored;
  } catch (error) {
    console.warn('[Recap] Stored recap load failed:', error);
    return null;
  }
}

export async function saveStoredRecap(recap: StoredRecap): Promise<void> {
  const key = storageKey(recap.editionKey);
  memoryCache.set(key, recap);

  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(key, recap, { ex: TTL_SECONDS });
  } catch (error) {
    // The in-memory copy above still spares this process a second batch call.
    console.warn('[Recap] Stored recap save failed:', error);
  }
}
