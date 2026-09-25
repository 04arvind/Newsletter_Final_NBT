/**
 * Zod schema for the article classification fields.
 *
 * The five fields below are the only classification data written to the
 * `articles` collection. They are validated once, in `upsertArticles()`, right
 * before the bulkWrite — so a malformed classification can never reach MongoDB
 * and poison the indexed slot queries that selection runs on.
 *
 * The enums mirror `ContentType` and `SlotId` in `../db/types`; the `satisfies`
 * clauses below fail the build if the two ever drift apart.
 */

import { z } from 'zod';
import type { ContentType, SlotId } from '../db/types';

const CONTENT_TYPE_VALUES = [
  'impact',
  'utility',
  'engagement',
  'curiosity',
  'event',
  'general',
] as const satisfies readonly ContentType[];

const SLOT_ID_VALUES = [
  'slot_1',
  'slot_2',
  'slot_3',
  'slot_4',
  'slot_5',
] as const satisfies readonly SlotId[];

/** Strict: any key beyond these five is rejected rather than silently stored. */
export const ArticleClassificationSchema = z.strictObject({
  /** `categoryFor()` always resolves to something — 'general' at worst. */
  category: z.string().min(1),
  /** Optional upstream value; absent for most sitemap articles. */
  topic: z.string().optional(),
  subtopics: z.array(z.string()),
  contentType: z.enum(CONTENT_TYPE_VALUES),
  eligibleSlots: z.array(z.enum(SLOT_ID_VALUES)),
});

export type ArticleClassification = z.infer<typeof ArticleClassificationSchema>;
