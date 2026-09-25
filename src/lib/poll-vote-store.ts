/**
 * Newsletter poll votes — who clicked what, counted across our own readers.
 *
 * The question and options come from NBT (see `fetch-nbt-poll.ts`), but the
 * split we render is ours: one vote per reader per poll, stored in MongoDB and
 * tallied on read. NBT's own site-wide numbers are kept alongside for context
 * but never mixed into these counts.
 *
 * Like the analytics route, this depends on Mongo. Unlike it, a missing
 * MONGODB_URI is not fatal: `isPollVotingEnabled()` lets callers degrade to a
 * read-only poll instead of erroring at the reader.
 */

import { getDb, isMongoConfigured } from './mongodb';

const COLLECTION = 'poll_votes';

export interface PollVote {
  pollId: string;
  /** Zero-based index into the poll's option list. */
  option: number;
  /** NBT's own 1-based option value, kept so a tally survives re-ordering. */
  optionValue: number;
  optionLabel: string;
  voterId: string;
  newsletterDate: string;
  userAgent?: string;
  firstVotedAt: Date;
  updatedAt: Date;
}

export interface PollTally {
  /** Votes per zero-based option index. */
  counts: Record<number, number>;
  totalVotes: number;
}

export function isPollVotingEnabled(): boolean {
  return isMongoConfigured();
}

let indexesReady: Promise<void> | null = null;

/** Idempotent, lazy — createIndex is a no-op once the index exists. */
function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    const pending = (async () => {
      const db = await getDb();
      const collection = db.collection<PollVote>(COLLECTION);
      // One vote per reader per poll. Re-clicking updates the existing row.
      await collection.createIndex({ pollId: 1, voterId: 1 }, { unique: true });
      await collection.createIndex({ pollId: 1, option: 1 });
      await collection.createIndex({ updatedAt: -1 });
    })().catch((error) => {
      // Let a later request retry instead of caching the failure forever.
      if (indexesReady === pending) indexesReady = null;
      throw error;
    });
    indexesReady = pending;
  }
  return indexesReady;
}

/**
 * Records (or changes) one reader's answer. Returns the fresh tally so the
 * caller can respond with the split in a single round trip.
 */
export async function recordPollVote(vote: {
  pollId: string;
  option: number;
  optionValue: number;
  optionLabel: string;
  voterId: string;
  userAgent?: string;
}): Promise<PollTally> {
  await ensureIndexes();
  const db = await getDb();
  const now = new Date();

  await db.collection<PollVote>(COLLECTION).updateOne(
    { pollId: vote.pollId, voterId: vote.voterId },
    {
      $set: {
        option: vote.option,
        optionValue: vote.optionValue,
        optionLabel: vote.optionLabel,
        userAgent: vote.userAgent,
        updatedAt: now,
      },
      $setOnInsert: {
        pollId: vote.pollId,
        voterId: vote.voterId,
        newsletterDate: now.toISOString().slice(0, 10),
        firstVotedAt: now,
      },
    },
    { upsert: true }
  );

  return getPollTally(vote.pollId);
}

/** Vote counts for one poll, keyed by zero-based option index. */
export async function getPollTally(pollId: string): Promise<PollTally> {
  await ensureIndexes();
  const db = await getDb();

  const rows = await db
    .collection<PollVote>(COLLECTION)
    .aggregate<{ _id: number; count: number }>([
      { $match: { pollId } },
      { $group: { _id: '$option', count: { $sum: 1 } } },
    ])
    .toArray();

  const counts: Record<number, number> = {};
  let totalVotes = 0;
  for (const row of rows) {
    counts[row._id] = row.count;
    totalVotes += row.count;
  }

  return { counts, totalVotes };
}

/** This reader's existing answer for a poll, or null if they haven't voted. */
export async function getVoterChoice(
  pollId: string,
  voterId: string
): Promise<number | null> {
  await ensureIndexes();
  const db = await getDb();

  const existing = await db
    .collection<PollVote>(COLLECTION)
    .findOne({ pollId, voterId }, { projection: { option: 1 } });

  return existing ? existing.option : null;
}

/**
 * Whole-number percentages that add up to exactly 100 (largest-remainder), so
 * the rendered bars never show 33/33/33 or 34/33/34 for an even split.
 */
export function toPercentages(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);

  const exact = counts.map((count) => (count * 100) / total);
  const floors = exact.map(Math.floor);
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);

  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }

  return floors;
}
