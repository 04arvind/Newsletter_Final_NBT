/**
 * The Poll model — today's poll *content* (question + options), persisted.
 *
 * Split of responsibilities around the daily poll:
 *   fetch-nbt-poll.ts  — reads question + options from NBT. No vote data.
 *   poll-store.ts      — this file: stores that content, resolves which slot
 *                        to read, and serves the last good poll when NBT is
 *                        unreachable.
 *   poll-vote-store.ts — our readers' votes, counted entirely by us.
 *
 * `getActivePoll()` is the entry point every caller should use: it never
 * throws, so a flaky upstream degrades the poll section instead of taking the
 * newsletter build down with it.
 */

import { fetchNbtPoll, type NbtPoll } from './fetch-nbt-poll';
import { getDb, isMongoConfigured } from './mongodb';

const POLLS = 'polls';
const CONFIG = 'poll_config';
const CONFIG_ID = 'nbt';

export interface StoredPoll {
  /** NBT's poll id — the natural key, and what votes are filed under. */
  pollId: string;
  sectionId: string;
  question: string;
  options: string[];
  /** When NBT last served us this poll. */
  fetchedAt: Date;
  /** When we first stored it — used to pick the newest on fallback. */
  firstSeenAt: Date;
  updatedAt: Date;
}

interface PollConfig {
  _id: string;
  /** Admin-settable slot id, for when NBT rotates the widget. */
  sectionId?: string;
  updatedAt: Date;
}

export type PollSource = 'live' | 'cache' | 'memory';

export interface ActivePoll {
  /** Null only when NBT failed *and* we have nothing stored yet. */
  poll: NbtPoll | null;
  /** True when `poll` came from a cache because the live fetch failed. */
  stale: boolean;
  source: PollSource | null;
  /** Why the live fetch failed, when it did. Surfaced for logs/debugging. */
  error?: string;
}

/**
 * Last good poll for this process. Covers the window where NBT is down and
 * Mongo isn't configured (or is also down), which is exactly when a build
 * would otherwise fall over.
 */
let lastGoodPoll: NbtPoll | null = null;

/**
 * Today's poll, with fallbacks. Never throws.
 *
 * Order of preference: live NBT -> newest poll in Mongo -> last poll this
 * process saw. A stale result is still returned, flagged via `stale`, because
 * yesterday's question renders better than an empty poll section.
 */
export async function getActivePoll(sectionId?: string): Promise<ActivePoll> {
  const slot = sectionId?.trim() || (await resolveConfiguredSectionId());

  try {
    const poll = await fetchNbtPoll(slot);
    lastGoodPoll = poll;
    // Persist, but don't let a write failure discard a poll we did fetch.
    await savePoll(poll).catch((error) => {
      console.error('[poll-store] failed to persist poll', poll.pollId, error);
    });
    return { poll, stale: false, source: 'live' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[poll-store] live NBT poll fetch failed, falling back:', reason);

    const cached = await getLatestStoredPoll().catch((dbError) => {
      console.error('[poll-store] cache read failed:', dbError);
      return null;
    });
    if (cached) return { poll: cached, stale: true, source: 'cache', error: reason };

    if (lastGoodPoll) {
      return { poll: lastGoodPoll, stale: true, source: 'memory', error: reason };
    }

    return { poll: null, stale: true, source: null, error: reason };
  }
}

/**
 * Which slot to read.
 *
 * NBT_POLL_SECTION_ID is the deploy-time pin and wins. The stored admin field
 * is the day-to-day knob — it can be changed while the app is running, which
 * is what you want when NBT rotates the slot. With neither set, the fetcher
 * auto-detects the id from NBT's homepage.
 */
export async function resolveConfiguredSectionId(): Promise<string | undefined> {
  const pinned = process.env.NBT_POLL_SECTION_ID?.trim();
  if (pinned) return pinned;

  const stored = await getAdminSectionId().catch(() => null);
  return stored || undefined;
}

/** The admin-set slot id, or null when unset / Mongo isn't configured. */
export async function getAdminSectionId(): Promise<string | null> {
  if (!isMongoConfigured()) return null;

  const db = await getDb();
  const config = await db
    .collection<PollConfig>(CONFIG)
    .findOne({ _id: CONFIG_ID }, { projection: { sectionId: 1 } });

  return config?.sectionId?.trim() || null;
}

/** Points the poll at a different NBT widget slot, no redeploy needed. */
export async function setAdminSectionId(sectionId: string): Promise<void> {
  const slot = sectionId.trim();
  if (!/^\d+$/.test(slot)) {
    throw new Error(`Invalid NBT section id: ${sectionId}`);
  }

  const db = await getDb();
  await db.collection<PollConfig>(CONFIG).updateOne(
    { _id: CONFIG_ID },
    { $set: { sectionId: slot, updatedAt: new Date() } },
    { upsert: true }
  );
}

/**
 * Upserts the poll content. Re-fetching the same poll refreshes `fetchedAt`
 * and picks up any edit NBT made to the wording, without disturbing the votes
 * already filed against this `pollId`.
 */
export async function savePoll(poll: NbtPoll): Promise<void> {
  if (!isMongoConfigured()) return;

  await ensureIndexes();
  const db = await getDb();
  const now = new Date();

  await db.collection<StoredPoll>(POLLS).updateOne(
    { pollId: poll.pollId },
    {
      $set: {
        sectionId: poll.sectionId,
        question: poll.question,
        options: poll.options,
        fetchedAt: new Date(poll.fetchedAt),
        updatedAt: now,
      },
      $setOnInsert: { pollId: poll.pollId, firstSeenAt: now },
    },
    { upsert: true }
  );
}

/** The most recently fetched poll we have stored, or null if there is none. */
export async function getLatestStoredPoll(): Promise<NbtPoll | null> {
  if (!isMongoConfigured()) return null;

  const db = await getDb();
  const row = await db
    .collection<StoredPoll>(POLLS)
    .findOne({}, { sort: { fetchedAt: -1 } });

  if (!row?.options?.length) return null;

  return {
    pollId: row.pollId,
    sectionId: row.sectionId,
    question: row.question,
    options: row.options,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

let indexesReady: Promise<void> | null = null;

/** Idempotent and lazy, mirroring `poll-vote-store.ts`. */
function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    const pending = (async () => {
      const db = await getDb();
      const polls = db.collection<StoredPoll>(POLLS);
      await polls.createIndex({ pollId: 1 }, { unique: true });
      await polls.createIndex({ fetchedAt: -1 });
    })().catch((error) => {
      // Let a later call retry rather than caching the failure forever.
      if (indexesReady === pending) indexesReady = null;
      throw error;
    });
    indexesReady = pending;
  }
  return indexesReady;
}
