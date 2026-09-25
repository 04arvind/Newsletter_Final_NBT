import { findTopRankedPodcast, isPodcastStoreEnabled, upsertRankedPodcasts } from './podcast-store';

export interface Podcast {
  id: string;
  videoId: string;
  title: string;
  url: string;
  embedUrl: string;
  thumbnail: string;
  description?: string;
  publishedAt: string;
  category?: string;
  duration?: string;
  author?: string;
  views: number;
  viewsPerHour: number;
  source: 'YOUTUBE';
  entities: string[];
  topics: string[];
  trendVelocity: number;
  topicPopularity: number;
  freshness: number;
  massAppeal: number;
  curiosity: number;
  newsImportance: number;
  newsletterFit: number;
  finalScore: number;
  scoreReason: string;
}

interface PodcastDraft {
  id: string;
  videoId: string;
  title: string;
  url: string;
  embedUrl: string;
  thumbnail: string;
  description?: string;
  publishedAt: string;
  ageHours: number;
  category?: string;
  duration?: string;
  author?: string;
  views: number;
  viewsPerHour: number;
  source: 'YOUTUBE';
  entities: string[];
  topics: string[];
}

interface TrendSignal {
  keyword: string;
  rank: number;
  score: number;
  velocity?: number | 'new';
}

interface EpisodeCandidate {
  videoId: string;
  title: string;
  views: number;
  ageHours: number;
  duration?: string;
  author?: string;
}

const DEFAULT_CHANNEL_PODCASTS_URL = 'https://www.youtube.com/@navbharattimes/podcasts';
const DEFAULT_WINDOW_HOURS = 48;
const DEFAULT_MAX_CANDIDATES = 8;
const MAX_PLAYLISTS = 4;
const MAX_EPISODES_PER_PLAYLIST = 40;
const WATCH_BASE = 'https://www.youtube.com/watch?v=';

function windowHours(): number {
  const configured = Number(process.env.NBT_PODCAST_WINDOW_HOURS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WINDOW_HOURS;
}

function maxCandidates(): number {
  const configured = Number(process.env.NBT_PODCAST_MAX_CANDIDATES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_CANDIDATES;
}

/**
 * Collects NBT podcast episodes from the channel's YouTube podcasts tab, keeping
 * the ones published inside the trending window. Newsletters cannot play video,
 * so every draft carries a thumbnail plus the watch URL it links to.
 */
export async function fetchPodcasts(): Promise<PodcastDraft[]> {
  const playlistIds = await fetchPodcastPlaylistIds();
  if (playlistIds.length === 0) return [];

  const pages = await Promise.allSettled(
    playlistIds.slice(0, MAX_PLAYLISTS).map((playlistId) =>
      fetchHtml(`https://www.youtube.com/playlist?list=${playlistId}&hl=en`)
    )
  );

  const candidates = new Map<string, EpisodeCandidate>();
  for (const page of pages) {
    if (page.status !== 'fulfilled') continue;
    for (const episode of parseEpisodes(page.value).slice(0, MAX_EPISODES_PER_PLAYLIST)) {
      const existing = candidates.get(episode.videoId);
      if (!existing || episode.views > existing.views) candidates.set(episode.videoId, episode);
    }
  }

  // Listing pages only give bucketed ages ("1 day ago"), so keep every episode whose
  // bucket can still start inside the window and let the exact upload date decide.
  const inWindow = Array.from(candidates.values()).filter((episode) => episode.ageHours <= windowHours());
  const shortlist = (inWindow.length > 0 ? inWindow : Array.from(candidates.values()))
    .sort((left, right) => right.views / Math.max(1, right.ageHours) - left.views / Math.max(1, left.ageHours))
    .slice(0, maxCandidates());

  const details = await Promise.allSettled(shortlist.map((episode) => buildDraft(episode)));
  const drafts = details
    .filter((result): result is PromiseFulfilledResult<PodcastDraft> => result.status === 'fulfilled')
    .map((result) => result.value);

  const exact = drafts.filter((draft) => draft.ageHours <= windowHours());
  // Never leave the section empty: fall back to the freshest episodes we found.
  return (exact.length > 0 ? exact : drafts).sort((left, right) => right.viewsPerHour - left.viewsPerHour);
}

export function rankPodcasts(podcasts: PodcastDraft[], trends: TrendSignal[]): Podcast[] {
  const peakVelocity = Math.max(1, ...podcasts.map((podcast) => podcast.viewsPerHour));
  return podcasts
    .map((podcast) => {
      const text = `${podcast.title} ${podcast.description || ''} ${podcast.category || ''}`.toLowerCase();
      const matches = trends.filter((trend) => text.includes(trend.keyword.toLowerCase()));
      const strongest = matches.sort((a, b) => a.rank - b.rank)[0];
      const topicPopularity = strongest ? Math.max(0, 100 - (strongest.rank - 1) * 8) : 20;
      // Watch velocity inside the window is the trending signal; trend feeds only
      // adjust how newsworthy that velocity is.
      const trendVelocity = Math.round(Math.min(100, (podcast.viewsPerHour / peakVelocity) * 100));
      const trendBoost = strongest
        ? strongest.velocity === 'new'
          ? 15
          : typeof strongest.velocity === 'number'
            ? Math.max(0, Math.min(20, strongest.velocity * 4))
            : 8
        : 0;
      const freshness = Math.max(0, Math.min(100, 100 - (podcast.ageHours / windowHours()) * 100));
      const massAppeal = scoreByTerms(text, ['भारत', 'देश', 'सरकार', 'जनता', 'india', 'politics', 'समाज']);
      const curiosity = scoreByTerms(text, ['क्यों', 'कैसे', 'राज', 'सच', 'विवाद', 'why', 'how', 'controversy']);
      const newsImportance = scoreByTerms(text, ['सरकार', 'चुनाव', 'नीति', 'सुप्रीम कोर्ट', 'मंत्री', 'आंदोलन', 'सरहद', 'breaking']);
      const newsletterFit = Math.round((topicPopularity + freshness + (podcast.description ? 20 : 0)) / 3);
      const finalScore = Math.round(
        (0.35 * trendVelocity +
          0.15 * topicPopularity +
          0.15 * freshness +
          0.12 * massAppeal +
          0.08 * curiosity +
          0.08 * newsImportance +
          0.07 * newsletterFit +
          trendBoost) * 100
      ) / 100;
      const matchedTopics = matches.slice(0, 5).map((trend) => trend.keyword);
      const velocityNote = `${podcast.views.toLocaleString('en-IN')} views in ${Math.round(podcast.ageHours)}h (${podcast.viewsPerHour}/hour)`;
      return {
        id: podcast.id,
        videoId: podcast.videoId,
        title: podcast.title,
        url: podcast.url,
        embedUrl: podcast.embedUrl,
        thumbnail: podcast.thumbnail,
        description: podcast.description,
        publishedAt: podcast.publishedAt,
        category: podcast.category,
        duration: podcast.duration,
        author: podcast.author,
        views: podcast.views,
        viewsPerHour: podcast.viewsPerHour,
        source: podcast.source,
        entities: extractEntities(podcast.title),
        topics: Array.from(new Set([...podcast.topics, ...matchedTopics])),
        trendVelocity,
        topicPopularity,
        freshness,
        massAppeal,
        curiosity,
        newsImportance,
        newsletterFit,
        finalScore,
        scoreReason: strongest
          ? `${velocityNote}; matched ranked trend "${strongest.keyword}".`
          : `${velocityNote}; ranked on watch velocity and freshness alone.`,
      } satisfies Podcast;
    })
    .sort((left, right) => right.finalScore - left.finalScore || right.freshness - left.freshness);
}

export async function getTopPodcastOfDay(trends: TrendSignal[]): Promise<Podcast | null> {
  try {
    const ranked = rankPodcasts(await fetchPodcasts(), trends);
    const winner = (await pickFromStore(ranked)) ?? ranked[0];
    if (!winner) return null;
    return { ...winner, thumbnail: await bestThumbnail(winner.videoId) };
  } catch (error) {
    console.warn('Podcast discovery or ranking failed:', error);
    return null;
  }
}

/**
 * Store this run's scores in `podcast_events` (one document per podcast) and
 * return the highest-scoring podcast ranked inside the window. Null when Mongo
 * is unavailable, so the caller falls back to this run's own ranking.
 */
async function pickFromStore(ranked: Podcast[]): Promise<Podcast | null> {
  if (!isPodcastStoreEnabled()) return null;
  try {
    await upsertRankedPodcasts(ranked);
    return await findTopRankedPodcast(new Date(Date.now() - windowHours() * 3600000));
  } catch (error) {
    console.warn('Podcast store failed; using this run\'s ranking:', error);
    return null;
  }
}

async function fetchPodcastPlaylistIds(): Promise<string[]> {
  const channelUrl = process.env.NBT_PODCAST_CHANNEL_URL || DEFAULT_CHANNEL_PODCASTS_URL;
  const html = await fetchHtml(`${channelUrl}${channelUrl.includes('?') ? '&' : '?'}hl=en`);
  const ids = collectLockups(readInitialData(html))
    .filter((lockup) => /PODCAST|PLAYLIST/.test(String(lockup.contentType || '')))
    .map((lockup) => String(lockup.contentId || ''))
    .filter((id) => /^(PL|UU|OL)[A-Za-z0-9_-]{10,}$/.test(id));
  return Array.from(new Set(ids));
}

function parseEpisodes(html: string): EpisodeCandidate[] {
  return collectLockups(readInitialData(html))
    .filter((lockup) => String(lockup.contentType || '').includes('VIDEO'))
    .map((lockup): EpisodeCandidate | null => {
      const videoId = String(lockup.contentId || '');
      const metadata = asRecord(asRecord(lockup.metadata).lockupMetadataViewModel);
      const title = String(asRecord(metadata.title).content || '').trim();
      const parts = metadataParts(metadata);
      const viewsText = parts.find((part) => /view/i.test(part));
      const agoText = parts.find((part) => /ago$/i.test(part));
      if (!videoId || !title || !agoText) return null;
      return {
        videoId,
        title,
        views: parseViewCount(viewsText),
        ageHours: parseRelativeHours(agoText),
        duration: durationBadge(lockup),
        author: parts[0],
      };
    })
    .filter((episode): episode is EpisodeCandidate => episode !== null);
}

async function buildDraft(episode: EpisodeCandidate): Promise<PodcastDraft> {
  const url = `${WATCH_BASE}${episode.videoId}`;
  const details = await fetchWatchDetails(episode.videoId);
  const publishedAt = details.publishedAt || new Date(Date.now() - episode.ageHours * 3600000).toISOString();
  const ageHours = Math.max(0.25, (Date.now() - new Date(publishedAt).getTime()) / 3600000);
  const views = details.views ?? episode.views;
  return {
    id: url,
    videoId: episode.videoId,
    title: details.title || episode.title,
    url,
    embedUrl: `https://www.youtube.com/embed/${episode.videoId}`,
    thumbnail: `https://i.ytimg.com/vi/${episode.videoId}/mqdefault.jpg`,
    description: details.description,
    publishedAt,
    ageHours,
    category: details.category,
    duration: details.duration || episode.duration,
    author: details.author || episode.author,
    views,
    viewsPerHour: Math.round(views / ageHours),
    source: 'YOUTUBE',
    entities: [],
    topics: [],
  };
}

interface WatchDetails {
  title?: string;
  description?: string;
  publishedAt?: string;
  views?: number;
  duration?: string;
  category?: string;
  author?: string;
}

async function fetchWatchDetails(videoId: string): Promise<WatchDetails> {
  try {
    const html = await fetchHtml(`${WATCH_BASE}${videoId}&hl=en`);
    const first = (pattern: RegExp): string | undefined => html.match(pattern)?.[1];
    const seconds = Number(first(/"lengthSeconds":"(\d+)"/));
    const views = Number(first(/"viewCount":"(\d+)"/));
    return {
      title: decodeJsonString(first(/"title":"((?:[^"\\]|\\.)*)","lengthSeconds"/)),
      description: decodeJsonString(first(/"shortDescription":"((?:[^"\\]|\\.)*)"/))
        ?.split('\n')
        .find((line) => line.trim().length > 0)
        ?.slice(0, 400),
      publishedAt: first(/"uploadDate":"([^"]+)"/),
      views: Number.isFinite(views) && views > 0 ? views : undefined,
      duration: Number.isFinite(seconds) && seconds > 0 ? formatDuration(seconds) : undefined,
      category: decodeJsonString(first(/"category":"((?:[^"\\]|\\.)*)"/)),
      author: decodeJsonString(first(/"author":"((?:[^"\\]|\\.)*)"/)),
    };
  } catch {
    return {};
  }
}

/**
 * Email clients cannot generate posters, so link the largest still that exists.
 * Only 16:9 variants are considered - hqdefault and sddefault are 4:3 crops of
 * the frame, so they letterbox or cut the sides off a widescreen thumbnail.
 */
async function bestThumbnail(videoId: string): Promise<string> {
  for (const variant of ['maxresdefault', 'hq720', 'mqdefault']) {
    const candidate = `https://i.ytimg.com/vi/${videoId}/${variant}.jpg`;
    try {
      const response = await fetch(candidate, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      if (response.ok) return candidate;
    } catch {
      // Fall through to the next variant.
    }
  }
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
    // YouTube playlist pages run ~2.5MB, over Next's 2MB data-cache ceiling, so
    // `next: { revalidate: 300 }` never actually stored anything — it only
    // logged "Failed to set Next.js data cache" on every request.
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`YouTube podcast fetch failed: ${response.status}`);
  return response.text();
}

function readInitialData(html: string): unknown {
  const match =
    html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/) ||
    html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function collectLockups(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) collectLockups(item, found);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'lockupViewModel' && value && typeof value === 'object') {
        found.push(value as Record<string, unknown>);
      }
      collectLockups(value, found);
    }
  }
  return found;
}

function metadataParts(metadata: Record<string, unknown>): string[] {
  const rows = asRecord(asRecord(metadata.metadata).contentMetadataViewModel).metadataRows;
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((row) => {
      const parts = asRecord(row).metadataParts;
      return Array.isArray(parts) ? parts : [];
    })
    .map((part) => String(asRecord(asRecord(part).text).content || '').trim())
    .filter(Boolean);
}

function durationBadge(lockup: Record<string, unknown>): string | undefined {
  const overlays = asRecord(asRecord(lockup.contentImage).thumbnailViewModel).overlays;
  if (!Array.isArray(overlays)) return undefined;
  for (const overlay of overlays) {
    const badges = asRecord(asRecord(overlay).thumbnailBottomOverlayViewModel).badges;
    if (!Array.isArray(badges)) continue;
    for (const badge of badges) {
      const text = String(asRecord(asRecord(badge).thumbnailBadgeViewModel).text || '').trim();
      if (/^\d{1,2}(:\d{2}){1,2}$/.test(text)) return text;
    }
  }
  return undefined;
}

/** "212K views" / "1.2M views" -> absolute view count. */
function parseViewCount(text?: string): number {
  const match = text?.replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]?.toLowerCase() || ''] || 1;
  return Math.round(Number(match[1]) * multiplier);
}

/** "20 hours ago" / "1 day ago" -> hours since upload (bucket lower bound). */
function parseRelativeHours(text: string): number {
  const match = text.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
  if (!match) return Number.POSITIVE_INFINITY;
  const unitHours: Record<string, number> = {
    second: 1 / 3600,
    minute: 1 / 60,
    hour: 1,
    day: 24,
    week: 168,
    month: 720,
    year: 8760,
  };
  return Number(match[1]) * (unitHours[match[2].toLowerCase()] || 1);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

function decodeJsonString(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function scoreByTerms(text: string, terms: string[]): number {
  const hits = terms.filter((term) => text.includes(term.toLowerCase())).length;
  return Math.min(100, 30 + hits * 14);
}

function extractEntities(title: string): string[] {
  return title.match(/[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*/g) || [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
