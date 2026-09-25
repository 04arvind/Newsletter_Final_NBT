import {
  getNewsletterWindow,
  isWithinNewsletterWindow,
  type NewsletterWindow,
} from './newsletter-window';

/**
 * Core Sitemap fetcher — reusable from merge route or standalone route.
 * Fetches NBT's source sitemap and filters it to the fixed newsletter window.
 */

export interface SitemapArticle {
  url: string;
  title: string;
  keywords: string[];
  publishedAt: string;
}

export interface SitemapResult {
  articles: SitemapArticle[];
  totalCount: number;
  fetchedAt: string;
}

export async function fetchSitemap(window: NewsletterWindow = getNewsletterWindow()): Promise<SitemapResult> {
  const sitemapUrl =
    process.env.SITEMAP_URL ||
    'https://navbharattimes.indiatimes.com/staticsitemap/nbt/news/sitemap-48hours.xml';

  const xml = await fetchSitemapXml(sitemapUrl);
  let articles = parseSitemapXml(xml);

  if (articles.length === 0) {
    const childSitemaps = extractLocs(xml);
    const childXml = await Promise.all(childSitemaps.map((url) => fetchSitemapXml(url)));
    articles = childXml.flatMap((item) => parseSitemapXml(item));
  }

  const filtered = articles.filter((a) => {
    return isWithinNewsletterWindow(a.publishedAt, window);
  });

  return {
    articles: filtered,
    totalCount: filtered.length,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchSitemapXml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'TrendingEngine/1.0 (Times Internet Editorial)',
      'Accept': 'application/xml, text/xml',
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`Sitemap fetch failed: ${response.status}`);
  }

  return response.text();
}

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/g), (match) => match[1].trim());
}

function parseSitemapXml(xml: string): SitemapArticle[] {
  const articles: SitemapArticle[] = [];

  const urlBlocks = xml.match(/<url>([\s\S]*?)<\/url>/g);
  if (!urlBlocks) return articles;

  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>\s*(.*?)\s*<\/loc>/);
    const url = locMatch ? locMatch[1].trim() : '';

    const titleMatch =
      block.match(/<news:title>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/news:title>/) ||
      block.match(/<news:title>\s*(.*?)\s*<\/news:title>/) ||
      block.match(/<title>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/title>/) ||
      block.match(/<title>\s*(.*?)\s*<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const kwMatch =
      block.match(/<news:keywords>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/news:keywords>/) ||
      block.match(/<news:keywords>\s*(.*?)\s*<\/news:keywords>/) ||
      block.match(/<keywords>\s*(.*?)\s*<\/keywords>/);
    const keywords = kwMatch
      ? kwMatch[1]
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : [];

    const dateMatch =
      block.match(/<news:publication_date>\s*(.*?)\s*<\/news:publication_date>/) ||
      block.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/);
    const publishedAt = dateMatch ? dateMatch[1].trim() : new Date().toISOString();

    if (url && title) {
      articles.push({ url, title, keywords, publishedAt });
    }
  }

  return articles;
}
