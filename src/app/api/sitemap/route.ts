/**
 * Sitemap API — Fetches NBT's source sitemap and applies the newsletter window
 * Returns structured articles with title, keywords, URL, and publish date
 */

import { NextResponse } from 'next/server';
import { getNewsletterWindow, isWithinNewsletterWindow } from '../../../lib/newsletter-window';

export const dynamic = 'force-dynamic';

interface SitemapArticle {
  url: string;
  title: string;
  keywords: string[];
  publishedAt: string;
}

export async function GET() {
  try {
    const sitemapUrl =
      process.env.SITEMAP_URL ||
      'https://navbharattimes.indiatimes.com/staticsitemap/nbt/news/sitemap-48hours.xml';

    const response = await fetch(sitemapUrl, {
      headers: {
        'User-Agent': 'TrendingEngine/1.0 (Times Internet Editorial)',
        'Accept': 'application/xml, text/xml',
      },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Sitemap fetch failed: ${response.status}` },
        { status: 502 }
      );
    }

    const xml = await response.text();
    const articles = parseSitemapXml(xml);

    const window = getNewsletterWindow();
    const filtered = articles.filter((article) => isWithinNewsletterWindow(article.publishedAt, window));

    return NextResponse.json({
      articles: filtered,
      totalCount: filtered.length,
      fetchedAt: new Date().toISOString(),
      windowStart: window.windowStartIso,
      windowEnd: window.windowEndIso,
    });
  } catch (error) {
    console.error('Sitemap API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sitemap', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Parse news sitemap XML without external dependencies.
 * Handles both standard sitemap and Google News sitemap namespaces.
 */
function parseSitemapXml(xml: string): SitemapArticle[] {
  const articles: SitemapArticle[] = [];

  // Match each <url> block
  const urlBlocks = xml.match(/<url>([\s\S]*?)<\/url>/g);
  if (!urlBlocks) return articles;

  for (const block of urlBlocks) {
    // Extract <loc>
    const locMatch = block.match(/<loc>\s*(.*?)\s*<\/loc>/);
    const url = locMatch ? locMatch[1].trim() : '';

    // Extract <news:title> or <title>
    const titleMatch =
      block.match(/<news:title>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/news:title>/) ||
      block.match(/<news:title>\s*(.*?)\s*<\/news:title>/) ||
      block.match(/<title>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/title>/) ||
      block.match(/<title>\s*(.*?)\s*<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract <news:keywords> or <keywords>
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

    // Extract <news:publication_date> or <lastmod>
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
