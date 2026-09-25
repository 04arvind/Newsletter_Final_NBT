/**
 * Where the email edition gets its data.
 *
 * `src/app/page.tsx` is the reference architecture: it renders nothing of its
 * own, it fetches. Two calls, in parallel, each with its own fallback —
 *
 *     GET /api/trends/merge  -> `.newsletter` (top story, podcast, cards, hook)
 *                               + `.fetchedAt` for the date line
 *     GET /api/poll          -> today's live NBT poll; on failure the page
 *                               falls back to the engine-generated `hook`
 *
 * — and then maps that payload onto the components. This module is the same
 * two fetches and the same mapping, moved to the server: an inbox has no
 * `useEffect`, so the issue is resolved once at render time and handed to
 * `renderNewsletterEmail` as `NewsletterEmailData`.
 *
 * The mapping itself is deliberately thin, because the field names in
 * `./newsletter-template.types` were chosen to mirror the `NewsletterPayload`
 * interfaces in `page.tsx`. Everything that is a *decision* rather than a
 * rename — which articles become recap bullets, how a bullet is clamped, which
 * stock image a card without artwork gets, how the date reads — lives in
 * `src/lib/newsletter-presentation.ts` and is shared with the web edition, so
 * the two cannot drift.
 *
 * What the browser can do and a server render cannot, and how it is handled:
 *
 *   - `page.tsx` retries the engine every 2s up to ten times while the reader
 *     watches a blank page. A cron invocation has a time budget, so the retry
 *     budget here is small and configurable (`attempts`).
 *   - `credentials: 'same-origin'` gives the web reader their own `yourVote`
 *     and the live tally. There is no reader at render time and the same HTML
 *     goes to everyone, so only the poll's *wording* is used; the vote itself
 *     is a link, see ./poll-link.
 *   - `<img onError>` retries a YouTube thumbnail at `hqdefault`. No email
 *     client runs that handler, so the fallback is resolved here instead.
 */

import { fetchJson } from '../fetch-json-internal';
import {
  cardImageFor,
  formatNewsletterDate,
  toSummaryLine,
} from '../newsletter-presentation';
import { renderNewsletterEmail } from './newsletter-template';
import type {
  EmailArticle,
  EmailPodcast,
  EmailPoll,
  NewsletterEmailData,
} from './newsletter-template.types';

/* =========================================================================
   API SHAPES — the same interfaces `page.tsx` declares for these two routes.
========================================================================= */

export interface MergeArticle {
  url: string;
  title: string;
  description?: string;
  image?: string;
  author?: string;
  newsletterSummary?: string;
}

export interface MergePodcast {
  id?: string;
  videoId?: string;
  title: string;
  url: string;
  thumbnail?: string;
  duration?: string;
}

export interface MergeHook {
  type: 'poll';
  question: string;
  options: string[];
}

export interface MergeNewsletter {
  topStory?: MergeArticle | null;
  podcast?: MergePodcast | null;
  selectedNews?: MergeArticle[];
  past24Hours?: MergeArticle[];
  hook?: MergeHook | null;
}

export interface MergeResponse {
  newsletter?: MergeNewsletter | null;
  fetchedAt?: string;
}

/** Only the poll's wording is used here; the numbers are a web-only concern. */
export interface LivePollResponse {
  poll?: {
    pollId: string;
    question: string;
    options: Array<{ label: string }>;
  };
}

export type LivePoll = NonNullable<LivePollResponse['poll']>;

/* =========================================================================
   FETCH  (page.tsx: the two useEffects)
========================================================================= */

const MERGE_PATH = '/api/trends/merge';
const POLL_PATH = '/api/poll';

/** Server-side retry budget. `page.tsx` uses 10 attempts; a cron cannot wait. */
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

export interface LoadOptions {
  /** Absolute origin of this app — `getInternalAppBaseUrl(request)`. */
  baseUrl: string;
  /** Attempts at the engine before giving up. Default 3. */
  attempts?: number;
  /** Pause between attempts, in ms. Default 2000. */
  retryDelayMs?: number;
  /** End of the editorial window (ISO), forwarded to the engine as `?at=`. */
  windowEnd?: string;
  /** Skip the poll fetch and use the engine hook (or nothing) instead. */
  skipPoll?: boolean;
  /** Passed straight through to `renderNewsletterEmail`. */
  labels?: NewsletterEmailData['labels'];
  footerLinks?: NewsletterEmailData['footerLinks'];
  subscriberToken?: string;
  unsubscribeUrl?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * The engine payload, retried the way `page.tsx` retries it — an issue built
 * from a failed fetch is worse than an issue built a few seconds later.
 */
export async function fetchMergePayload(
  baseUrl: string,
  {
    attempts = DEFAULT_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    windowEnd,
  }: { attempts?: number; retryDelayMs?: number; windowEnd?: string } = {}
): Promise<MergeResponse> {
  const url = `${trimOrigin(baseUrl)}${MERGE_PATH}${
    windowEnd ? `?at=${encodeURIComponent(windowEnd)}` : ''
  }`;
  const budget = Math.max(1, attempts);
  let lastError = 'unknown error';

  for (let attempt = 0; attempt < budget; attempt += 1) {
    const result = await fetchJson<MergeResponse>(url);
    if (result.ok) return result.data;
    lastError = result.error;
    if (attempt + 1 < budget) await sleep(retryDelayMs);
  }

  throw new Error(`Trending engine unavailable (${lastError})`);
}

/**
 * Today's poll. A failure is not fatal — `GET /api/poll` answers 503 when
 * nothing is live and nothing is cached, and the caller then falls back to the
 * engine-generated hook, exactly as the page does.
 */
export async function fetchLivePoll(baseUrl: string): Promise<LivePoll | null> {
  const result = await fetchJson<LivePollResponse>(`${trimOrigin(baseUrl)}${POLL_PATH}`);
  if (!result.ok) return null;
  return result.data.poll?.options?.length ? result.data.poll : null;
}

/* =========================================================================
   MAP  (page.tsx: everything between the fetches and the JSX)
========================================================================= */

function toEmailArticle(article: MergeArticle, index: number): EmailArticle {
  return {
    title: article.title,
    description: article.description,
    url: article.url,
    image: cardImageFor(article.image, index),
    author: article.author,
  };
}

/**
 * The lead story keeps `page.tsx`'s rule of its own: no stock fallback, only
 * its real artwork or none at all.
 */
function toHeroArticle(article: MergeArticle): EmailArticle {
  return {
    title: article.title,
    description: article.description,
    url: article.url,
    image: article.image,
    author: article.author,
  };
}

function toEmailPodcast(podcast: MergePodcast): EmailPodcast {
  return {
    title: podcast.title,
    url: podcast.url,
    // The web lets `onError` fall back to the always-present `hqdefault` frame
    // when a maxres/sd thumbnail 404s. Resolved here because no email client
    // will run that handler; no thumbnail at all falls through to the bundled
    // artwork inside the template.
    thumbnail:
      podcast.thumbnail ||
      (podcast.videoId ? `https://i.ytimg.com/vi/${podcast.videoId}/hqdefault.jpg` : undefined),
    duration: podcast.duration,
  };
}

/**
 * Live poll first, engine hook second — the same precedence `pollQuestion` /
 * `pollOptions` apply in `page.tsx`.
 *
 * A hook-only fallback has no `pollId`, and that is survivable: the vote
 * endpoint re-resolves the active poll server-side rather than trusting the
 * link (see ./poll-link), so the id in the URL records what the reader was
 * shown — it is not the authority on what they voted in.
 */
function toEmailPoll(
  livePoll: LivePoll | null,
  hook: MergeHook | null | undefined
): EmailPoll | null {
  if (livePoll?.options?.length) {
    return {
      pollId: livePoll.pollId,
      question: livePoll.question,
      options: livePoll.options.map((option) => option.label),
    };
  }
  if (hook?.options?.length) {
    return { pollId: '', question: hook.question, options: hook.options };
  }
  return null;
}

export interface MapOptions
  extends Omit<LoadOptions, 'attempts' | 'retryDelayMs' | 'skipPoll'> {
  merge: MergeResponse;
  livePoll?: LivePoll | null;
}

/**
 * Turn an already-fetched engine payload into the renderer's input.
 *
 * Kept separate from the fetching so a caller that already holds the merge
 * response — a pipeline stage, a preview route, a test — can render the issue
 * without a second round trip.
 */
export function toNewsletterEmailData({
  baseUrl,
  merge,
  livePoll = null,
  labels,
  footerLinks,
  subscriberToken,
  unsubscribeUrl,
}: MapOptions): NewsletterEmailData {
  const newsletter = merge.newsletter ?? null;
  const topStory = newsletter?.topStory ?? null;
  const selectedNews = newsletter?.selectedNews ?? [];
  const past24Hours = newsletter?.past24Hours ?? [];
  const podcast = newsletter?.podcast ?? null;

  // NEWSLETTER_RECAP_SIZE is 6, so a 7th bullet here would always miss its
  // generated summary and fall through to the local rewriting path.
  const recap = [topStory, ...selectedNews.slice(0, 5)]
    .filter((article): article is MergeArticle => Boolean(article))
    .map((article) => toSummaryLine(article));

  return {
    baseUrl: trimOrigin(baseUrl),
    date: formatNewsletterDate(merge.fetchedAt),
    recap,
    topStory: topStory ? toHeroArticle(topStory) : null,
    podcast: podcast ? toEmailPodcast(podcast) : null,
    // Each grid restarts the stock-artwork rotation, the way two separate
    // `.news-grid`s do on the web.
    selectedNews: selectedNews.map(toEmailArticle),
    past24Hours: past24Hours.map(toEmailArticle),
    poll: toEmailPoll(livePoll, newsletter?.hook),
    labels,
    footerLinks,
    subscriberToken,
    unsubscribeUrl,
  };
}

/* =========================================================================
   LOAD + RENDER
========================================================================= */

/** Fetch both sources — in parallel, as the page's two effects do — and map. */
export async function loadNewsletterEmailData(
  options: LoadOptions
): Promise<NewsletterEmailData> {
  const { baseUrl, attempts, retryDelayMs, skipPoll, windowEnd } = options;

  const [merge, livePoll] = await Promise.all([
    fetchMergePayload(baseUrl, { attempts, retryDelayMs, windowEnd }),
    skipPoll ? Promise.resolve(null) : fetchLivePoll(baseUrl),
  ]);

  return toNewsletterEmailData({ ...options, merge, livePoll });
}

export interface RenderedNewsletterEmail {
  html: string;
  /** The lead story's headline — the same subject `assemble.ts` picks. */
  subject: string;
  /** The formatted date line, so a caller can log or store the issue by it. */
  date: string;
  data: NewsletterEmailData;
}

/**
 * The one call a route needs: fetch today's issue and render it as the email.
 *
 * Per-recipient values stay as `{{tokens}}` in the returned HTML, so the issue
 * is rendered once and personalised at send time — the shape `deliver.ts`
 * already assumes.
 */
export async function buildNewsletterEmail(
  options: LoadOptions
): Promise<RenderedNewsletterEmail> {
  const data = await loadNewsletterEmailData(options);

  return {
    html: renderNewsletterEmail(data),
    subject: data.topStory?.title || `NBT न्यूजलेटर — ${data.date}`,
    date: data.date,
    data,
  };
}
