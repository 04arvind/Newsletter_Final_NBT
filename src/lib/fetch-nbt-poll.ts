/**
 * Today's NBT poll — question and options only.
 *
 * NBT renders its homepage poll through an iframe:
 *   /in-focus/poll?sectionid=<sectionId>&host=nbt&platform=desktop&...
 *
 * That page is an empty shell; the widget fills itself from a public JSON feed.
 * We skip the shell and call the feed directly — no HTML parsing, no markup to
 * break when NBT restyles the widget:
 *
 *   GET https://global-feed.indiatimes.com/wufs/feed/list/poll
 *         ?client=nbt&pc=nbt&dm=t&msid=<sectionId>
 *   -> { items: [ { pollid, hl: "<question>", options: [{ id, text }] }, ... ] }
 *
 * `items[0]` is the poll currently live in that slot.
 *
 * Deliberately NOT used: the sibling `feed/show/poll?msid=<pollid>` endpoint.
 * It returns the same question and options but adds `perc` and `count` per
 * option — NBT's site-wide tally. Our newsletter counts its own readers' votes
 * (see `poll-vote-store.ts`), so mixing in NBT's numbers would be wrong. The
 * `list` endpoint carries no vote data at all, which makes that mistake
 * impossible rather than merely discouraged.
 */

/** Question and options as NBT publishes them. No vote data, by construction. */
export interface NbtPoll {
  /** NBT's id for this specific poll. Changes when the poll rotates. */
  pollId: string;
  /** The widget slot the poll was read from. */
  sectionId: string;
  question: string;
  /** Option labels in NBT's own display order. */
  options: string[];
  fetchedAt: string;
}

const FEED_BASE = 'https://global-feed.indiatimes.com/wufs';
const NBT_HOME = 'https://navbharattimes.indiatimes.com/';
const NBT_SITE = 'nbt';

/**
 * Last-resort slot id, used only when nothing else resolves one. NBT rotates
 * the *poll* inside a slot far more often than it changes the slot itself, so
 * this stays useful for a long time — but prefer NBT_POLL_SECTION_ID or the
 * admin field (see `poll-store.ts`) so a rotation never needs a code change.
 */
export const NBT_POLL_FALLBACK_SECTION_ID = '119246015';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** How long a fetched poll stays warm in Next's data cache. */
const POLL_TTL_SECONDS = parseInt(process.env.NBT_POLL_TTL || '600', 10);

/** Upstream is a nice-to-have; never let it hold a render open. */
const REQUEST_TIMEOUT_MS = 8000;

interface PollFeedOption {
  id?: string;
  text?: string;
}

interface PollFeedItem {
  pollid?: string;
  hl?: string;
  options?: PollFeedOption[];
}

interface PollFeed {
  items?: PollFeedItem[];
}

/**
 * Reads the poll currently live in one NBT widget slot.
 *
 * @param sectionId NBT's widget slot id. Omit to resolve it from
 *   NBT_POLL_SECTION_ID, then from the homepage, then from the fallback above.
 * @throws when the feed is unreachable or its shape no longer parses. Callers
 *   that must not fail should go through `getActivePoll()` in `poll-store.ts`,
 *   which falls back to the last poll we stored.
 */
export async function fetchNbtPoll(sectionId?: string): Promise<NbtPoll> {
  const slot = sectionId?.trim() || (await resolveSectionId());

  const url =
    `${FEED_BASE}/feed/list/poll` +
    `?client=${NBT_SITE}&pc=${NBT_SITE}&dm=t&msid=${encodeURIComponent(slot)}`;

  const feed = await getJson<PollFeed>(url);
  const item = feed?.items?.[0];
  if (!item) {
    throw new Error(`NBT poll ${slot}: feed returned no poll items`);
  }

  const pollId = String(item.pollid || '').trim();
  if (!pollId) {
    throw new Error(`NBT poll ${slot}: feed item has no pollid`);
  }

  const question = cleanText(item.hl || '');
  if (!question) {
    throw new Error(`NBT poll ${pollId}: feed item has no question`);
  }

  const options = parseOptions(item.options);
  // A one-option poll is not a poll — treat it as a shape change, not as data.
  if (options.length < 2) {
    throw new Error(
      `NBT poll ${pollId}: expected at least 2 options, got ${options.length}`
    );
  }

  return {
    pollId,
    sectionId: slot,
    question,
    options,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Which slot to read when the caller didn't name one.
 *
 * NBT_POLL_SECTION_ID is a deliberate pin and wins outright. Otherwise we read
 * the id straight off the homepage, so a rotation is picked up on its own.
 */
export async function resolveSectionId(): Promise<string> {
  const pinned = process.env.NBT_POLL_SECTION_ID?.trim();
  if (pinned) return pinned;

  const detected = await detectHomepageSectionId();
  return detected || NBT_POLL_FALLBACK_SECTION_ID;
}

/**
 * The homepage ships the slot id as a React prop inside the flight payload,
 * where every quote is backslash-escaped:
 *
 *   \"pollSectionId\":\"119246015\"
 *
 * Hence the optional `\\` before each quote — it also matches the unescaped
 * form, in case NBT ever inlines the prop directly.
 */
async function detectHomepageSectionId(): Promise<string> {
  try {
    const home = await getText(NBT_HOME);
    const match = home.match(/pollSectionId\\?"\s*:\s*\\?"(\d+)\\?"/);
    return match ? match[1] : '';
  } catch {
    // Auto-detect is best-effort; the caller still has a fallback id.
    return '';
  }
}

/**
 * Option labels in NBT's display order.
 *
 * The feed already returns them ordered, but it also numbers them (`id`:
 * "1", "2", ...). When every id is numeric we sort by it, so a reordered
 * response can't silently reshuffle the labels our stored votes point at.
 */
function parseOptions(options: PollFeedOption[] | undefined): string[] {
  if (!Array.isArray(options)) return [];

  const parsed = options.map((option, index) => ({
    label: cleanText(option?.text || ''),
    order: Number(option?.id),
    index,
  }));

  const numbered = parsed.every((option) => Number.isFinite(option.order));
  if (numbered) {
    parsed.sort((left, right) => left.order - right.order);
  }

  return parsed.map((option) => option.label).filter(Boolean);
}

/** Strips stray tags, decodes entities, drops the ZWJ runs NBT sprinkles in. */
function cleanText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/[\u200c\u200d]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    zwj: '\u200d',
    zwnj: '\u200c',
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };

  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&([a-z]+);/gi, (full, name: string) => named[name.toLowerCase()] ?? full);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await request(url, 'application/json');
  return (await response.json()) as T;
}

async function getText(url: string): Promise<string> {
  const response = await request(url, 'text/html,application/xhtml+xml');
  return response.text();
}

async function request(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: accept,
      'Accept-Language': 'hi-IN,hi;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    next: { revalidate: POLL_TTL_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`NBT poll fetch failed (${response.status}): ${url}`);
  }

  return response;
}
