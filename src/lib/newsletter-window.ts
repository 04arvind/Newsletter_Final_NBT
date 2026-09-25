export const NEWSLETTER_WINDOW_HOURS = 24;
export const NEWSLETTER_ISSUE_HOUR = 6;
export const NEWSLETTER_TIMEZONE = 'Asia/Kolkata';

const IST_OFFSET_MINUTES = 5 * 60 + 30;

export interface NewsletterWindow {
  issueAt: Date;
  windowStart: Date;
  windowEnd: Date;
  windowStartIso: string;
  windowEndIso: string;
  cacheKey: string;
}

/** Return the most recent scheduled 06:00 issue boundary in Asia/Kolkata. */
export function getNewsletterWindow(now = new Date()): NewsletterWindow {
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NEWSLETTER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(
    localParts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const localDate = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day)
  );
  const issueDate = Number(values.hour) < NEWSLETTER_ISSUE_HOUR
    ? localDate - 24 * 60 * 60 * 1000
    : localDate;
  const issueAt = new Date(issueDate - IST_OFFSET_MINUTES * 60 * 1000 + NEWSLETTER_ISSUE_HOUR * 60 * 60 * 1000);
  return getNewsletterWindowEndingAt(issueAt);
}

/** The same rolling 24-hour window, ending at an exact moment (e.g. a Generate HTML click). */
export function getNewsletterWindowEndingAt(issueAt: Date): NewsletterWindow {
  const windowEnd = issueAt;
  const windowStart = new Date(
    windowEnd.getTime() - NEWSLETTER_WINDOW_HOURS * 60 * 60 * 1000
  );
  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();

  return {
    issueAt,
    windowStart,
    windowEnd,
    windowStartIso,
    windowEndIso,
    cacheKey: `merge:${windowStartIso}:${windowEndIso}`,
  };
}

export function isWithinNewsletterWindow(
  publishedAt: string,
  window: Pick<NewsletterWindow, 'windowStart' | 'windowEnd'>
): boolean {
  const timestamp = new Date(publishedAt).getTime();
  return Number.isFinite(timestamp) &&
    timestamp >= window.windowStart.getTime() &&
    timestamp < window.windowEnd.getTime();
}
