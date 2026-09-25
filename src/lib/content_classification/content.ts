/**
 * Content classification — stage 3 of the newsletter pipeline.
 *
 *     MongoDB Articles
 *            |
 *     Content Classification   <- here
 *            |
 *     External Trend Signals
 *
 * The rules themselves live in `src/lib/db/article.ts`, next to the write path
 * that applies them, because classification runs *at ingest*: `upsertArticles()`
 * stores `category`, `contentType` and `eligibleSlots` on the document, so
 * filling a slot later is an indexed query rather than a regex sweep over the
 * whole article pool on every run.
 *
 * This module is the named entry point for that stage. Import from here when
 * you want to classify without writing — scoring a candidate, backfilling, or
 * checking why an article did or did not qualify for a slot.
 *
 * NOTE: `phase1-selection.ts` carries a second copy of these term lists for
 * in-memory selection. If you change a list, change it in both places, or a
 * stored `eligibleSlots` will disagree with what the selector accepts.
 */

export {
  /** Dominant editorial character: impact / utility / engagement / curiosity / event. */
  contentTypeFor,
  /** Every slot an article may fill. Precomputed and stored at ingest. */
  eligibleSlotsFor,
  /** Upstream category when the source gives one, else inferred from title and URL. */
  categoryFor,
  /** `Gold Price` -> `topic_gold_price`. The grouping key for a developing story. */
  deriveTopicId,
  /** Stable primary key for an article — the publisher msid where available. */
  deriveArticleId,
  /** Query-stripped, protocol-normalized URL. The uniqueness key alongside `_id`. */
  canonicalizeUrl,
  type ClassifiableArticle,
} from '../db/article';

export type { ContentType, SlotId } from '../db/types';
export { SLOT_IDS, SLOT_THEMES } from '../db/types';
