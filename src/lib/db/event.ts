/**
 * Upcoming events — the inventory slot 5 draws from.
 *
 * Slot 5 is the one that regularly comes up empty, because it needs something
 * that has not happened yet and the article pool is almost entirely about
 * things that already have. Keeping events in their own collection means they
 * can be seeded ahead of time (a tournament final, a budget date, a launch)
 * rather than hoping a matching headline appears in the 24-hour window.
 */

import { createHash } from 'crypto';
import type { Collection } from 'mongodb';
import { getDb } from '../mongodb';
import { ensureDbIndexes } from './client';
import type { SlotId, UpcomingEventDoc } from './types';

export const UPCOMING_EVENTS_COLLECTION = 'upcoming_events';

export async function getUpcomingEventsCollection(): Promise<Collection<UpcomingEventDoc>> {
  await ensureDbIndexes();
  const db = await getDb();
  return db.collection<UpcomingEventDoc>(UPCOMING_EVENTS_COLLECTION);
}

/** Title plus date, so the same event re-seeded from another source updates in place. */
export function deriveEventId(title: string, eventDate: Date): string {
  const key = `${title.toLowerCase().trim()}|${eventDate.toISOString().slice(0, 10)}`;
  return `event_${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}

export interface UpcomingEventInput {
  title: string;
  eventDate: string | Date;
  category: string;
  description?: string;
  url?: string;
  importance?: number;
  historicalInterest?: number;
  currentSearchInterest?: number;
  eligibleSlot?: SlotId;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export async function upsertUpcomingEvent(
  input: UpcomingEventInput
): Promise<string> {
  const eventDate = input.eventDate instanceof Date ? input.eventDate : new Date(input.eventDate);
  if (Number.isNaN(eventDate.getTime())) {
    throw new Error(`Invalid eventDate for "${input.title}"`);
  }

  const id = deriveEventId(input.title, eventDate);
  const now = new Date();
  const collection = await getUpcomingEventsCollection();

  await collection.updateOne(
    { _id: id },
    {
      $set: {
        title: input.title.trim(),
        description: input.description,
        url: input.url,
        eventDate,
        category: input.category.toLowerCase(),
        importance: clamp(input.importance ?? 50, 0, 100),
        historicalInterest: input.historicalInterest,
        currentSearchInterest: input.currentSearchInterest,
        eligibleSlot: input.eligibleSlot || 'slot_5',
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return id;
}

/**
 * The best event to feature, ranked by a blend of editorial importance and live
 * search interest.
 *
 * `withinDays` defaults to 14: far enough out to have something in hand, close
 * enough that readers still care. Events in the past are excluded outright —
 * a stale "coming next" is worse than an empty slot.
 */
export async function findSlotEventCandidates(options?: {
  withinDays?: number;
  category?: string;
  limit?: number;
  now?: Date;
}): Promise<UpcomingEventDoc[]> {
  const now = options?.now || new Date();
  const horizon = new Date(now.getTime() + (options?.withinDays ?? 14) * 24 * 60 * 60 * 1000);
  const collection = await getUpcomingEventsCollection();

  return collection
    .aggregate<UpcomingEventDoc>([
      {
        $match: {
          eligibleSlot: 'slot_5',
          eventDate: { $gte: now, $lte: horizon },
          ...(options?.category ? { category: options.category } : {}),
        },
      },
      {
        $addFields: {
          rankScore: {
            $add: [
              { $multiply: ['$importance', 0.5] },
              { $multiply: [{ $ifNull: ['$currentSearchInterest', 0] }, 0.3] },
              { $multiply: [{ $ifNull: ['$historicalInterest', 0] }, 0.2] },
            ],
          },
        },
      },
      { $sort: { rankScore: -1, eventDate: 1 } },
      { $limit: options?.limit ?? 10 },
      { $unset: 'rankScore' },
    ])
    .toArray();
}

/** Drop events that have passed. Safe to run from the daily pipeline. */
export async function pruneExpiredEvents(now = new Date()): Promise<number> {
  const collection = await getUpcomingEventsCollection();
  const result = await collection.deleteMany({ eventDate: { $lt: now } });
  return result.deletedCount;
}
