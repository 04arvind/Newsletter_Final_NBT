/**
 * Populate `nbtNewsletter.html` from the issue the existing pipeline built.
 *
 *   /api/trends/merge  ->  toNewsletterEmailData()  ->  NewsletterEmailData
 *                                                              |
 *                                        fillNewsletterTemplate()
 *                                                              |
 *                                           the finished newsletter HTML
 *
 * This module fetches nothing, ranks nothing and renders no markup of its own:
 * the markup is `./nbtNewsletter.html`, the data is whatever
 * `src/lib/email/newsletter-data.ts` already produced. All it does is put the
 * second into the first.
 *
 * The small helpers below (`esc`, `clamp`, `absoluteUrl`, `safeUrl`) mirror the
 * private ones in `src/lib/email/newsletter-template.ts` character for
 * character. They are repeated rather than imported because that file does not
 * export them and is not ours to change — every value that reaches the template
 * has to be escaped and clamped exactly as the renderer escapes and clamps it,
 * or the populated document would drift from the design it was cut from.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { withArticleUtm } from '../../email/article-utm';
import { withCampaignUtm } from '../../email/campaign-utm';
import { DEFAULT_FOOTER_LINKS } from '../../email/newsletter-template';
import type {
  EmailArticle,
  NewsletterEmailData,
} from '../../email/newsletter-template.types';

/** `renderHero` / `renderNewsCard` clamp widths, in characters. */
const HERO_DESCRIPTION_MAX = 240;
const SELECTED_DESCRIPTION_MAX = 190;
const PAST_DESCRIPTION_MAX = 125;

/** How many cards the template carries, per the pipeline's own limits. */
const SELECTED_SLOTS = 5;
const PAST_SLOTS = 3;
const RECAP_BULLETS = 6;

/** `PODCAST_FALLBACK_PATH` in the renderer — artwork for a podcast with none. */
const PODCAST_FALLBACK_IMAGE =
  'https://static.langimg.com/thumb/119164302/navbharat-times.jpg?width=366&resizemode=4';

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'src',
  'lib',
  'InternalTool',
  'GenerateHTML',
  'nbtNewsletter.html'
);

/** Read once per process — the file never changes between requests. */
let cached: string | null = null;

export async function loadNewsletterTemplate(): Promise<string> {
  if (cached === null) cached = await readFile(TEMPLATE_PATH, 'utf8');
  return cached;
}

/* ------------------------------------------------- renderer-mirrored helpers */

function esc(value: string | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(baseUrl: string, value: string | undefined): string {
  if (!value) return '';
  if (/^(https?:|mailto:|\{\{)/i.test(value)) return value;
  return `${baseUrl.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`;
}

function safeUrl(baseUrl: string, value: string | undefined): string {
  const absolute = absoluteUrl(baseUrl, value);
  if (!absolute) return '';
  return /^(https?:\/\/|mailto:|\{\{)/i.test(absolute) ? esc(absolute) : '';
}

/** What `-webkit-line-clamp` does visually, done to the string instead. */
function clamp(value: string | undefined, maxLength: number): string {
  const text = (value ?? '').trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/* ------------------------------------------------------------- substitution */

type Values = Map<string, string>;

/**
 * One story's five slots.
 *
 * `url` and `url_utm` are filled separately on purpose: the headline points at
 * the bare URL and the artwork and call to action at the tagged one, which is
 * the split `src/lib/email/article-utm.ts` exists to keep.
 */
function putArticle(
  values: Values,
  prefix: string,
  article: EmailArticle | null | undefined,
  baseUrl: string,
  descriptionMax: number
): void {
  values.set(`${prefix}_title`, esc(article?.title));
  values.set(`${prefix}_description`, esc(clamp(article?.description, descriptionMax)));
  values.set(`${prefix}_author`, esc(article?.author));
  values.set(`${prefix}_url`, safeUrl(baseUrl, article?.url));
  values.set(`${prefix}_url_utm`, safeUrl(baseUrl, withArticleUtm(article?.url)));
  values.set(
    `${prefix}_image`,
    article?.image ? esc(absoluteUrl(baseUrl, article.image)) : ''
  );
}

/**
 * Substitute every `{{token}}` the template carries.
 *
 * `{{subscriber_email}}` is deliberately left alone: it is the per-recipient
 * placeholder the delivery layer substitutes at send time, exactly as it does
 * in the HTML the renderer produces today.
 */
export function fillNewsletterTemplate(
  template: string,
  data: NewsletterEmailData
): string {
  const baseUrl = data.baseUrl.replace(/\/+$/, '');
  const values: Values = new Map();

  values.set('base_url', esc(baseUrl));
  values.set('issue_date', esc(data.date));
  values.set('preheader', esc(data.preheader ?? data.recap?.[0] ?? ''));

  for (let i = 0; i < RECAP_BULLETS; i += 1) {
    values.set(`recap_${i + 1}`, esc(data.recap?.[i] ?? ''));
  }

  putArticle(values, 'top_story', data.topStory, baseUrl, HERO_DESCRIPTION_MAX);

  for (let i = 0; i < SELECTED_SLOTS; i += 1) {
    putArticle(
      values,
      `selected_${i + 1}`,
      data.selectedNews?.[i],
      baseUrl,
      SELECTED_DESCRIPTION_MAX
    );
  }

  for (let i = 0; i < PAST_SLOTS; i += 1) {
    putArticle(
      values,
      `past24_${i + 1}`,
      data.past24Hours?.[i],
      baseUrl,
      PAST_DESCRIPTION_MAX
    );
  }

  values.set('podcast_title', esc(data.podcast?.title));
  values.set('podcast_duration', esc(data.podcast?.duration));
  // Both fallbacks are the renderer's own: a podcast with no link falls back to
  // the NBT YouTube channel, one with no artwork to the bundled frame.
  const podcastUrl = (url?: string) =>
    safeUrl(baseUrl, withCampaignUtm(absoluteUrl(baseUrl, url)));
  values.set(
    'podcast_url_utm',
    podcastUrl(data.podcast?.url) || podcastUrl(DEFAULT_FOOTER_LINKS.youtube)
  );
  values.set(
    'podcast_thumbnail',
    esc(absoluteUrl(baseUrl, data.podcast?.thumbnail || PODCAST_FALLBACK_IMAGE))
  );

  return template.replace(/\{\{([a-z0-9_]+)\}\}/gi, (token, name: string) =>
    values.has(name) ? (values.get(name) as string) : token
  );
}

/** Read the template and fill it — what the Internal Tool's Generate does. */
export async function renderNewsletterFromTemplate(
  data: NewsletterEmailData
): Promise<string> {
  return fillNewsletterTemplate(await loadNewsletterTemplate(), data);
}

/* ------------------------------------------------------------- shape guard */

const filled = (value: string | undefined | null): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const completeArticle = (article: EmailArticle | undefined): boolean =>
  Boolean(article) &&
  filled(article?.title) &&
  filled(article?.url) &&
  filled(article?.image) &&
  filled(article?.description);

/**
 * Whether this issue fits the template.
 *
 * `nbtNewsletter.html` is a fixed shape — six recap bullets, five selected
 * stories, three in the last-24h grid, a podcast, a hero with artwork, a byline
 * and a standfirst. The renderer it was cut from drops any of those when the
 * data is missing; a static file cannot, so an issue that is short of one would
 * be populated with an empty card or a blank `src` rather than with nothing.
 *
 * When the shape matches, filling the template reproduces
 * `renderNewsletterEmail` byte for byte, which is what makes it safe to store
 * and mail. When it does not, the caller keeps the renderer's own output — the
 * same document, composed for the data that actually arrived.
 */
export function canFillTemplate(data: NewsletterEmailData): boolean {
  const recap = data.recap ?? [];
  const selected = data.selectedNews ?? [];
  const past = data.past24Hours ?? [];

  return (
    recap.length === RECAP_BULLETS &&
    recap.every(filled) &&
    completeArticle(data.topStory ?? undefined) &&
    Boolean(data.podcast) &&
    filled(data.podcast?.title) &&
    filled(data.podcast?.duration) &&
    selected.length === SELECTED_SLOTS &&
    selected.every(completeArticle) &&
    past.length === PAST_SLOTS &&
    past.every(completeArticle)
  );
}
