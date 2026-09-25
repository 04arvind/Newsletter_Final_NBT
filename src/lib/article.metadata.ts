import * as cheerio from 'cheerio';

export interface ArticleMetadata {
  description?: string;
  image?: string;
  author?: string;
}

export async function fetchArticleMetadata(url: string): Promise<ArticleMetadata> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TrendingEngine/1.0 (Times Internet Editorial)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 300 },
    });

    if (!response.ok) return {};

    const html = await response.text();
    const $ = cheerio.load(html);
    const valueFromSelectors = (selectors: string[]): string | undefined => {
      for (const selector of selectors) {
        const element = $(selector).first();
        const value = (element.attr('content') || element.text()).trim();
        if (value) return value;
      }
      return undefined;
    };

    const author = valueFromSelectors([
      'meta[name="author"]',
      'meta[property="article:author"]',
      '[class*="author"] [class*="name"]',
      '[class*="byline"]',
    ]) || getJsonLdAuthor($);

    return {
      description: valueFromSelectors([
        'meta[property="og:description"]',
        'meta[name="description"]',
      ]),
      image: valueFromSelectors(['meta[property="og:image"]', 'meta[name="twitter:image"]']),
      author,
    };
  } catch {
    return {};
  }
}

function getJsonLdAuthor($: cheerio.CheerioAPI): string | undefined {
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(script).text()) as Record<string, unknown>;
      const author = data.author;
      if (typeof author === 'string') return author.trim() || undefined;
      if (author && typeof author === 'object' && 'name' in author) {
        const name = (author as { name?: unknown }).name;
        if (typeof name === 'string') return name.trim() || undefined;
      }
    } catch {
    }
  }
  return undefined;
}