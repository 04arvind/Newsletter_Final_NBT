/**
 * Shared MongoDB Atlas connection (native `mongodb` driver).
 *
 * The client is cached so Next.js does not open a new connection pool on every
 * request: in development it lives on `globalThis` to survive HMR reloads,
 * in production a module-level singleton is enough.
 *
 * Unlike the Upstash helpers in `trend-history-store.ts` / `podcast-history-store.ts`,
 * which silently no-op when unconfigured, analytics now depends on Mongo — so a
 * missing MONGODB_URI throws. It throws at *call* time, not import time, so a
 * build without the env var still succeeds.
 */

import { MongoClient, type Db } from 'mongodb';

const DEFAULT_DB_NAME = 'nbt_newsletter';

type MongoCache = {
  client: MongoClient;
  promise: Promise<MongoClient>;
};

const globalForMongo = globalThis as unknown as {
  __mongoCache?: MongoCache;
};

let cache: MongoCache | undefined = globalForMongo.__mongoCache;

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add it to your .env file (see .env.example) to enable MongoDB-backed persistence.'
    );
  }
  return uri;
}

export function getMongoDbName(): string {
  return process.env.MONGODB_DB || DEFAULT_DB_NAME;
}

/** Connected client, reused across requests and HMR reloads. */
export async function getMongoClient(): Promise<MongoClient> {
  if (!cache) {
    const client = new MongoClient(getMongoUri());
    cache = { client, promise: client.connect() };
    // Only pin to globalThis in dev — in production the module singleton above
    // is already per-process and we don't want to leak across lambda instances.
    if (process.env.NODE_ENV !== 'production') {
      globalForMongo.__mongoCache = cache;
    }
  }

  try {
    return await cache.promise;
  } catch (error) {
    // Drop the failed cache entry so the next call can retry a fresh connect.
    cache = undefined;
    globalForMongo.__mongoCache = undefined;
    throw error;
  }
}

/** Connected `Db` handle for MONGODB_DB (default "nbt_newsletter"). */
export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(getMongoDbName());
}
