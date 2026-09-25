/**
 * Data contract for the HTML email edition of the newsletter.
 *
 * The web newsletter (`src/app/page.tsx`) fetches `/api/trends/merge` and
 * `/api/poll` in the browser. An email cannot, so the same shapes are passed
 * in at render time instead — the field names deliberately mirror the
 * `NewsletterPayload` interfaces in `page.tsx` so a caller can hand over the
 * engine response with almost no mapping.
 *
 * Nothing here is rendered with hardcoded article copy: every value is either
 * supplied by the caller or left as a `{{token}}` for the delivery layer to
 * substitute per recipient (see `EMAIL_TOKENS`).
 */

/** One story — top story, "आज की प्रमुख खबरें" card, or "पिछले 24 घंटे में" card. */
export interface EmailArticle {
  title: string;
  description?: string;
  url: string;
  /** Absolute URL. Relative paths are resolved against `baseUrl`. */
  image?: string;
  author?: string;
}

export interface EmailPodcast {
  title: string;
  url: string;
  /** Absolute URL; falls back to the bundled trending-news artwork. */
  thumbnail?: string;
  /** e.g. "12:04" — rendered as the badge in the thumbnail's bottom-right. */
  duration?: string;
}

/**
 * Today's poll. `pollId` and the option order must match what
 * `GET /api/poll` returned, because the vote links carry them back to the
 * server (see ./poll-link).
 */
export interface EmailPoll {
  pollId: string;
  question: string;
  options: string[];
}

/** Every outbound link in the footer. Defaults mirror `src/app/Footer.tsx`. */
export interface EmailFooterLinks {
  home: string;
  playStore: string;
  appStore: string;
  youtube: string;
  x: string;
  facebook: string;
  instagram: string;
  whatsapp: string;
  otherNewsletters: string;
  subscribe: string;
  unsubscribe: string;
  feedback: string;
}

/** Hindi copy the design hardcodes. Exposed so it can be overridden per issue. */
export interface EmailLabels {
  greeting: string;
  recapHeading: string;
  topStoryLabel: string;
  podcastLabel: string;
  selectedNewsHeading: string;
  past24HoursHeading: string;
  readFullStory: string;
  moreNews: string;
  appHeading: string;
  appBlurb: string;
  followHeading: string;
  handle: string;
  otherNewsletters: string;
  subscribe: string;
  unsubscribe: string;
  feedback: string;
  copyright: string;
}

export interface NewsletterEmailData {
  /**
   * Absolute origin of the app, e.g. `https://newsletter.navbharattimes.com`.
   * Used for asset URLs and for the poll vote endpoint — email clients have no
   * document base, so every URL in the output must be absolute.
   */
  baseUrl: string;

  /** Already-formatted issue date, e.g. "17 सितंबर 2026". */
  date: string;

  /** "आज का न्यूज़ रीकैप" bullets, in order. */
  recap: string[];

  topStory?: EmailArticle | null;
  podcast?: EmailPodcast | null;
  selectedNews?: EmailArticle[];
  past24Hours?: EmailArticle[];
  poll?: EmailPoll | null;

  /** Inbox preview line. Defaults to the first recap bullet. */
  preheader?: string;

  /**
   * Identifies the reader in poll vote links. Defaults to the
   * `{{subscriber_email}}` token, substituted at send time the same way
   * `deliver.ts` already substitutes `{{unsubscribe_url}}`.
   */
  subscriberToken?: string;

  /**
   * Overrides the footer's unsubscribe link. Left unset it is built as a
   * working one-click URL against the existing `GET /api/unsubscribe` handler
   * (see ./subscription-links). Pass `EMAIL_TOKENS.UNSUBSCRIBE_URL` instead to
   * keep the `{{unsubscribe_url}}` placeholder `deliver.ts` substitutes.
   */
  unsubscribeUrl?: string;

  footerLinks?: Partial<EmailFooterLinks>;
  labels?: Partial<EmailLabels>;
}

/**
 * Placeholders left in the rendered HTML for the delivery layer to replace.
 *
 * `deliver.ts` uses `String.prototype.replace` with a string pattern, which
 * swaps only the *first* occurrence — each token below therefore appears
 * exactly once in the output, except `SUBSCRIBER` which appears once per poll
 * option and needs a global replace.
 */
export const EMAIL_TOKENS = {
  /** Already consumed by `src/lib/pipeline/deliver.ts`. */
  UNSUBSCRIBE_URL: '{{unsubscribe_url}}',
  /** Must be substituted with a URL-encoded value — it sits in a query string. */
  SUBSCRIBER: '{{subscriber_email}}',
} as const;
