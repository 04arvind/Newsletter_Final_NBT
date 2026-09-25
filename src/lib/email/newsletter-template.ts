/**
 * Email edition of the NBT newsletter.
 *
 * `src/app/page.tsx` + the newsletter rules in `src/app/globals.css` are the
 * single source of truth for this design; this file is a translation of them,
 * not a second design. Every colour, gutter, font size, border and section
 * ordering below is lifted from those two files — the comments name the CSS
 * rule each value comes from so the two can be diffed later.
 *
 * What changes, and only because an inbox forces it:
 *
 *   - CSS grid / flexbox -> nested tables with explicit widths. Outlook renders
 *     through Word, which supports neither.
 *   - The stylesheet -> inline `style` attributes. Only the responsive rules
 *     stay in a `<style>` block, since a media query cannot be inlined; clients
 *     that drop `<style>` simply keep the 600px composition.
 *   - `-webkit-line-clamp` -> the text is trimmed here, at render time. No
 *     email client clamps lines.
 *   - `react-icons` / Font Awesome -> inline SVG and Unicode glyphs, see
 *     ./newsletter-icons.
 *
 * Nothing in the output is a hardcoded article: the caller passes the issue in
 * (./newsletter-template.types), and the per-recipient values stay as
 * `{{tokens}}` for the delivery layer to substitute.
 */

import {
  ARROW_GLYPH,
  iconApple,
  iconArrowRight,
  iconComment,
  iconGooglePlay,
  iconMic,
  iconMobile,
  iconNewspaper,
  iconStars,
} from "./newsletter-icons";
import { withArticleUtm } from "./article-utm";
import { withCampaignUtm } from "./campaign-utm";
import { buildSubscribeUrl, buildUnsubscribeUrl } from "./subscription-links";
import {
  EMAIL_TOKENS,
  type EmailArticle,
  type EmailFooterLinks,
  type EmailLabels,
  type EmailPodcast,
  type NewsletterEmailData,
} from "./newsletter-template.types";

/* =========================================================================
   DESIGN TOKENS  (globals.css :root, lines 42-56)
========================================================================= */

const RED = "#d91f26";
const BLACK = "#111317";
const GRAY = "#666666";
const LIGHT_GRAY = "#e7e1dc";
const CREAM = "#f7f3ee";
const SOFT_RED = "#fff2f0";
const WHITE = "#ffffff";

/** `.hero-section` / `.top-podcast` bottom rule. */
const HAIRLINE = "#e6e1dc";
/** `.newsletter` border. */
const SHELL_BORDER = "#eeeeee";

/** `.newsletter { max-width: 600px }`. */
const SHELL_WIDTH = 600;
/** `.masthead` / `.header-date` / `.red-line` / `.daily-summary` gutter. */
const HEADER_GUTTER = 36;
/** `.hero-section` / `.top-podcast` / `.selected-news` gutter. */
const BODY_GUTTER = 25;
/** Content width inside the 25px gutter — the podcast media and card images. */
const BODY_WIDTH = SHELL_WIDTH - BODY_GUTTER * 2;

/**
 * `--font-newsletter`: Poppins then Noto Sans Devanagari (app/layout.tsx).
 * Gmail and Outlook ignore the webfont `<link>`, so the fallback chain has to
 * end somewhere that ships Devanagari on every platform — Nirmala UI on
 * Windows, Kohinoor/Devanagari Sangam on Apple.
 */
const FONT_STACK =
  "'Poppins','Noto Sans Devanagari','Nirmala UI','Kohinoor Devanagari',Arial,sans-serif";

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700;800" +
  "&family=Poppins:wght@400;500;600;700;800;900&display=swap";

/**
 * Mirrors the long-token guard in `globals.css` (`overflow-wrap: break-word`
 * on the headline and copy selectors): a Latin word or bare URL inside Hindi
 * copy offers no break opportunity, and a table cell answers that by growing
 * — one such token in a title would push the 600px shell wider than the
 * phone it is being read on. Inlined rather than left to the `<style>` block
 * because Outlook needs the legacy `word-wrap` spelling and drops `<style>`
 * rules it does not recognise.
 */
const BREAK_WORD = "word-wrap:break-word;overflow-wrap:break-word;";

/**
 * Stand-ins for `-webkit-line-clamp`, in characters. The web clamps the hero
 * blurb at 4 lines of 15px, the "आज की प्रमुख खबरें" card at 3 lines of 14px
 * and the "पिछले 24 घंटे में" card at 2 — measured against the ~550px content
 * width at roughly 58 Devanagari characters to the line.
 */
const HERO_DESCRIPTION_MAX = 240;
const SELECTED_DESCRIPTION_MAX = 190;
const PAST_DESCRIPTION_MAX = 125;

/**
 * Artwork, mirroring the fallbacks in `page.tsx`.
 *
 * Both are absolute CDN URLs rather than paths under `/newsletter-assets/`:
 * an inbox has no document base, and `baseUrl` is the app's own origin, so a
 * bundled path resolves to something only this server can serve — on a
 * developer machine that is `http://localhost:3000/...`, which is a broken
 * image for every recipient.
 */
const LOGO_PATH =
  "https://static.langimg.com/thumb/119164302/navbharat-times.jpg?width=366&resizemode=4";
const PODCAST_FALLBACK_PATH =
  "https://static.langimg.com/thumb/119164302/navbharat-times.jpg?width=366&resizemode=4";

/**
 * The footer's two app-store badges — official artwork in place of the
 * hand-built `storeButton()` chips, which are kept below as the fallback.
 *
 * ⚠ Both are `.svg`. Gmail (web, Android, iOS) and every version of Outlook
 * drop or fail to decode an SVG `<img>`, so those readers get the `alt` text
 * where the badge should be — the same client limitation ./newsletter-icons
 * documents for inline `<svg>`. Re-export both as PNG to a CDN the recipients
 * can reach and swap the two URLs here; nothing else in the template changes.
 */
const PLAY_STORE_BADGE_SRC =
  "https://cdn.prod.website-files.com/6908e0cf1bd5d556432c7a7d/697bb5f4a15f8caf086be0a0_play-store-badge.svg";
const APP_STORE_BADGE_SRC =
  "https://cdn.prod.website-files.com/6908e0cf1bd5d556432c7a7d/697bb5d3af87d5f4084f2b63_app-store-badge.svg";
/**
 * The pair is matched on height, not width.
 *
 * Both files are 42px tall at source but not equally wide — 142 for Play, 125
 * for the App Store — so the single 108px width they used to share rendered
 * them at two different heights, the App Store badge 4px taller than the one
 * beside it. Equal height is also how both stores' own guidelines size them.
 *
 * The widths below are what 34px tall works out to (142/42 and 125/42), and
 * they still total the 222px the pair measured before, gap included, so the
 * app column and everything around it is unmoved.
 */
const STORE_BADGE_HEIGHT = 34;
const PLAY_BADGE_WIDTH = 115;
const APP_BADGE_WIDTH = 101;

/**
 * The five footer social marks, keyed to `EmailFooterLinks`.
 *
 * Artwork rather than the inline `<svg>` these chips used to carry: Gmail
 * (web, Android, iOS) drops inline SVG, so those readers had five empty
 * coloured circles — the limitation ./newsletter-icons documents for itself.
 * Swapping a mark means swapping a URL here and nothing else.
 */
const SOCIAL_ICON_SRC = {
  youtube: "https://navbharattimes.indiatimes.com/photo/134329850/pic.jpg",
  x:
    "https://navbharattimes.indiatimes.com/photo/134329852/pic.jpg",
  facebook: "https://navbharattimes.indiatimes.com/photo/134329842/pic.jpg",
  instagram:
    "https://navbharattimes.indiatimes.com/photo/134329848/pic.jpg" +
    "?semt=ais_hybrid&w=740&q=80",
  whatsapp: "https://navbharattimes.indiatimes.com/photo/134329844/pic.jpg",
    // "https://static.vecteezy.com/system/resources/thumbnails/023/986/631/small/" +
    // "whatsapp-logo-whatsapp-logo-transparent-whatsapp-icon-transparent-free-free-png.png",
} as const;

/**
 * The mark centred on the podcast artwork, in place of the `PLAY_GLYPH` chip.
 *
 * 16:9 and 96x54 on purpose: the red button inside it is ~65% x ~81% of the
 * frame, so it lands at ~62x44 — the size the chip it replaces was. The
 * artwork is opaque (white, not transparent), which is why it is served at
 * `PLAY_MARK_OPACITY` rather than flat: faded, the thumbnail still reads
 * through it. Outlook's VML branch ignores `opacity` and shows it solid.
 */
const PLAY_MARK_SRC =
  "https://1000logos.net/wp-content/uploads/2017/05/Red-YouTube-logo.png";
const PLAY_MARK_WIDTH = 96;
const PLAY_MARK_HEIGHT = 54;
const PLAY_MARK_OPACITY = "0.8";

/** Defaults copied from the constants at the top of `src/app/Footer.tsx`. */
export const DEFAULT_FOOTER_LINKS: EmailFooterLinks = {
  home: "https://navbharattimes.indiatimes.com/",
  playStore: "https://play.google.com/store/apps/details?id=com.nbt.reader",
  appStore:
    "https://apps.apple.com/in/app/navbharat-times-hindi-news/id656093141",
  youtube: "https://www.youtube.com/channel/UCl8wUKzoUVzg7U6ky1ZR8hQ",
  x: "https://x.com/NavbharatTimes?lang=en",
  facebook: "https://www.facebook.com/navbharattimes/",
  instagram: "https://www.instagram.com/nbt_news/",
  whatsapp: "https://www.whatsapp.com/channel/0029VaABWbW6mYPG1GXDSY3H",
  otherNewsletters: "https://navbharattimes.indiatimes.com/",
  // Both are built per render from `baseUrl` and the subscriber token, because
  // they point at this app's own endpoints rather than at NBT — see
  // ./subscription-links and the resolution in `renderNewsletterEmail`.
  subscribe: "",
  unsubscribe: "",
  feedback: "https://navbharattimes.indiatimes.com/",
};

/** Fixed Hindi copy, as it appears in `page.tsx` and `Footer.tsx`. */
export const DEFAULT_LABELS: EmailLabels = {
  greeting: "सुप्रभात",
  recapHeading: "आज का न्यूज़ रीकैप",
  topStoryLabel: "मुख्य समाचार",
  podcastLabel: "आज का पॉडकास्ट",
  selectedNewsHeading: "चाय की चुस्की और आज की मुख्य बातें",
  past24HoursHeading: "बीते 24 घंटे: द बिग 3",
  readFullStory: "पूरी खबर पढ़ें",
  moreNews: "और खबरें देखें",
  appHeading: "NBT ऐप डाउनलोड करें",
  appBlurb: "ताज़ा खबरें, वीडियो, लाइव अपडेट और भी बहुत कुछ अब आपके मोबाइल पर।",
  followHeading: "हमें फॉलो करें",
  handle: "@NBT हिंदी",
  otherNewsletters: "अन्य न्यूज़लेटर",
  subscribe: "सब्सक्राइब करें",
  unsubscribe: "अनसब्सक्राइब करें",
  feedback: "अपनी राय दें",
  copyright: "© 2026 Navbharat Times. सर्वाधिकार सुरक्षित।",
};

/* =========================================================================
   HTML helpers
========================================================================= */

function esc(value: string | undefined | null): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Email clients have no document base, so relative paths never resolve — every
 * asset and link has to be absolute before it leaves here.
 */
function absoluteUrl(baseUrl: string, value: string | undefined): string {
  if (!value) return "";
  if (/^(https?:|mailto:|\{\{)/i.test(value)) return value;
  return `${baseUrl.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
}

/** Drops anything that is not a link an inbox should follow. */
function safeUrl(baseUrl: string, value: string | undefined): string {
  const absolute = absoluteUrl(baseUrl, value);
  if (!absolute) return "";
  return /^(https?:\/\/|mailto:|\{\{)/i.test(absolute) ? esc(absolute) : "";
}

/**
 * `safeUrl` with the newsletter campaign tags on it — every link the issue
 * generates itself. Article links are not routed through here: they keep the
 * `withArticleUtm` treatment in `renderHero` / `renderNewsCard`, untouched.
 */
function campaignUrl(baseUrl: string, value: string | undefined): string {
  return safeUrl(baseUrl, withCampaignUtm(absoluteUrl(baseUrl, value)));
}

/**
 * An article image, wrapped in that article's own link.
 *
 * `href` is the `withArticleUtm` URL, the same one the "पूरी खबर पढ़ें →" call
 * to action points at — a click on the artwork is a click on the story, and
 * tagging it as anything else would split one story's traffic across two
 * campaigns.
 *
 * `display:block` keeps the anchor the exact size of the image rather than the
 * line box around it, so the hit area is the artwork and nothing beside it, and
 * `line-height:0;font-size:0` closes the descender gap Outlook otherwise leaves
 * under an image inside a link. The 10px spacer that follows each image stays
 * outside the anchor, so the gap below the artwork is not clickable.
 *
 * An article with no usable URL keeps the plain `<img>` — the same guard the
 * headline already applies.
 */
function linkedImage(href: string, img: string): string {
  if (!href) return img;
  return (
    `<a href="${href}" target="_blank" ` +
    'style="display:block;line-height:0;font-size:0;text-decoration:none;">' +
    `${img}</a>`
  );
}

/** What `-webkit-line-clamp` does visually, done to the string instead. */
function clamp(value: string | undefined, maxLength: number): string {
  const text = (value ?? "").trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** `<table>` with every attribute an email client needs to behave. */
function tableOpen(attributes = ""): string {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" ${attributes}>`;
}

/** A vertical gap, the one spacing primitive Outlook never gets wrong. */
function spacer(height: number): string {
  return (
    `<tr><td style="font-size:0;line-height:0;height:${height}px;">` +
    `&nbsp;</td></tr>`
  );
}

/**
 * A heading with its icon, the way `.daily-summary h2` and
 * `.top-podcast-label` lay one out (`display:flex; gap:6px`).
 */
function headingWithIcon(
  icon: string,
  text: string,
  fontSize: number,
  color: string,
  className = "",
): string {
  const attributes = className
    ? `class="${className}" style="border-collapse:collapse;"`
    : 'style="border-collapse:collapse;"';
  return (
    `${tableOpen(attributes)}<tr>` +
    `<td style="padding-right:6px;line-height:0;font-size:0;" valign="middle">${icon}</td>` +
    `<td valign="middle" style="font-family:${FONT_STACK};font-size:${fontSize}px;` +
    `line-height:1.4;font-weight:800;color:${color};">${esc(text)}</td>` +
    "</tr></table>"
  );
}

/* =========================================================================
   SECTIONS  (in the order `page.tsx` renders them)
========================================================================= */

/** `.masthead` — centred 130px logo, padding 25px 36px 18px. */
function renderMasthead(baseUrl: string): string {
  return (
    `<tr><td class="nl-gutter" align="center" style="padding:25px ${HEADER_GUTTER}px 18px;">` +
    `<a href="${campaignUrl(baseUrl, DEFAULT_FOOTER_LINKS.home)}" target="_blank">` +
    `<img src="${esc(absoluteUrl(baseUrl, LOGO_PATH))}" width="130" alt="NBT" ` +
    'style="display:block;width:130px;max-width:130px;height:auto;border:0;outline:none;' +
    'text-decoration:none;" /></a></td></tr>'
  );
}

/** `.newsletter-date.header-date` — right aligned, padding 0 36px 10px. */
function renderDate(date: string): string {
  return (
    `<tr><td class="nl-gutter" align="right" style="padding:0 ${HEADER_GUTTER}px 10px;` +
    `font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${GRAY};">` +
    `${esc(date)}</td></tr>`
  );
}

/**
 * `.red-line` — 3px red rule inset by the 36px gutter.
 *
 * This is the one cell in the issue whose only job is to be *seen*, so it can
 * afford none of the assumptions the invisible `spacer()` rows can. Asking a
 * cell to be 3px tall and filling it with a background is the fragile part:
 * a mobile client that will not resolve a sub-line-height cell collapses it,
 * and a background with nothing to paint on is simply not there — which is
 * exactly how the rule can be missing on a phone and correct on a laptop.
 *
 * So the 3px comes from a **border**, which paints whether or not the cell
 * resolves any height at all, and the cell itself is deliberately zero-height
 * so the two can never add up to 6px:
 *
 *   - `border-top:3px solid` — the actual rule. Supported everywhere,
 *     Word included, and independent of the cell's own height.
 *   - `height:0;line-height:0;font-size:0` + `mso-line-height-rule:exactly` —
 *     the cell contributes nothing, so the border is the whole 3px.
 *   - `height="3"` and `bgcolor` as *attributes* — the fallback for a client
 *     that drops the inline `style` altogether (the Gmail app signed into a
 *     non-Gmail account being the usual one). There, CSS is gone, so the
 *     attributes draw the same 3px red bar on their own.
 *
 * Either path renders 3px, never both. No breakpoint involved, and the
 * desktop result is unchanged.
 */
function renderRedLine(): string {
  return (
    `<tr><td class="nl-gutter" style="padding:0 ${HEADER_GUTTER}px;">` +
    // `separate` with zero spacing, not `collapse`: a collapsed border is
    // shared with the table edge, so only half of the 3px lands inside the
    // cell and the rule measures 1.5px.
    `${tableOpen('width="100%" style="border-collapse:separate;border-spacing:0;"')}<tr>` +
    `<td height="3" bgcolor="${RED}" ` +
    `style="height:0;line-height:0;font-size:0;mso-line-height-rule:exactly;` +
    `border-top:3px solid ${RED};">&nbsp;</td>` +
    "</tr></table></td></tr>"
  );
}

/**
 * `.reader-greeting` — red, 18px/800, margin-top 18px.
 *
 * `BODY_GUTTER`: this is the same 18px/800 red heading as the section labels,
 * so it starts where they do.
 */
function renderGreeting(text: string): string {
  return (
    `<tr><td class="nl-gutter" style="padding:18px ${BODY_GUTTER}px 12px;` +
    `font-family:${FONT_STACK};font-size:18px;font-weight:800;color:${RED};">` +
    `${esc(text)}</td></tr>`
  );
}

/**
 * `.daily-summary` — the "आज का न्यूज़ रीकैप" box: 2px red border, radius 4,
 * `--soft-red` fill, inset by the 36px gutter.
 *
 * `<ul>` bullets are unreliable in Outlook, so the list is a table whose first
 * column holds the disc; the 22px `padding-left` of `.daily-summary ul` becomes
 * the bullet column plus its gap.
 */
function renderRecap(heading: string, bullets: string[]): string {
  if (!bullets.length) return "";

  const items = bullets
    .map(
      (line) =>
        "<tr>" +
        `<td class="nl-recap-text" valign="top" width="22" style="width:22px;padding:3px 0;` +
        `font-family:${FONT_STACK};font-size:16px;line-height:1.55;color:${BLACK};">&bull;</td>` +
        `<td class="nl-recap-text" valign="top" style="padding:3px 0;font-family:${FONT_STACK};` +
        `font-size:16px;line-height:1.55;color:${BLACK};${BREAK_WORD}">${esc(line)}</td>` +
        "</tr>",
    )
    .join("");

  return (
    `<tr><td class="nl-gutter" style="padding:0 ${HEADER_GUTTER}px 18px;">` +
    `${tableOpen(
      `width="100%" style="border-collapse:separate;border:2px solid ${RED};border-radius:4px;` +
        `background-color:${SOFT_RED};"`,
    )}` +
    '<tr><td class="nl-recap-box" style="padding:16px 20px 14px;">' +
    `${headingWithIcon(iconStars({ size: 18, color: RED }), heading, 18, RED)}` +
    '<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>' +
    `${tableOpen('width="100%" style="border-collapse:collapse;"')}${items}</table>` +
    "</td></tr></table></td></tr>"
  );
}

/**
 * `.hero-section` — image, headline, blurb, red link.
 *
 * `.hero-text { display: contents }` flattens the text block into the grid, so
 * the DOM order there is exactly the stacking order reproduced here.
 */
function renderHero(
  baseUrl: string,
  story: EmailArticle | null | undefined,
  labels: EmailLabels,
): string {
  if (!story) return "";

  const url = safeUrl(baseUrl, story.url);
  const readMoreUrl = safeUrl(baseUrl, withArticleUtm(story.url));
  const image = story.image ? esc(absoluteUrl(baseUrl, story.image)) : "";
  const description = clamp(story.description, HERO_DESCRIPTION_MAX);

  // `page.tsx` only sets a hero `src` when the story actually carries an image
  // — there is no stock fallback on the lead story.
  const imageBlock = image
    ? linkedImage(
        readMoreUrl,
        `<img src="${image}" width="${BODY_WIDTH}" alt="${esc(story.title)}" ` +
          `style="display:block;width:100%;max-width:${BODY_WIDTH}px;height:auto;border:0;` +
          'border-radius:10px;outline:none;text-decoration:none;" />',
      ) + '<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>'
    : "";

  return (
    `<tr><td class="nl-gutter" style="padding:0 ${BODY_GUTTER}px 18px;` +
    `border-bottom:1px solid ${HAIRLINE};">` +
    imageBlock +
    `<h2 class="nl-hero-title" style="margin:10px 0 10px;font-family:${FONT_STACK};` +
    `font-size:25px;line-height:1.35;font-weight:900;color:${BLACK};${BREAK_WORD}">` +
    `${esc(story.title)}</h2>` +
    (description
      ? `<p class="nl-hero-text" style="margin:0;font-family:${FONT_STACK};font-size:15px;` +
        `line-height:1.7;color:${BLACK};${BREAK_WORD}">${esc(description)}</p>`
      : "") +
    (url
      ? '<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>' +
        `<a class="nl-hero-link" href="${readMoreUrl}" target="_blank" ` +
        `style="font-family:${FONT_STACK};font-size:15px;font-weight:800;color:${RED};` +
        `text-decoration:none;">${esc(labels.readFullStory)} ${ARROW_GLYPH}</a>`
      : "") +
    "</td></tr>"
  );
}

/**
 * `.top-podcast` — label, then the 16:9 thumbnail with the centred play badge
 * and the duration chip in its bottom-right corner.
 *
 * The web stacks those two with `position:absolute`, which no email client
 * honours. The thumbnail becomes a cell background instead, with a VML `v:rect`
 * so Outlook's Word engine paints it too, and the badges are laid out as rows
 * inside that cell.
 */
function renderPodcast(
  baseUrl: string,
  podcast: EmailPodcast | null | undefined,
  labels: EmailLabels,
): string {
  if (!podcast) return "";

  const url =
    campaignUrl(baseUrl, podcast.url) ||
    campaignUrl(baseUrl, DEFAULT_FOOTER_LINKS.youtube);
  const thumb = esc(
    absoluteUrl(baseUrl, podcast.thumbnail || PODCAST_FALLBACK_PATH),
  );
  const mediaHeight = Math.round((BODY_WIDTH * 9) / 16); // `aspect-ratio: 16 / 9`

  // 309px tall: the play mark sits on the centre line, the duration chip in
  // the bottom-right inset by 10px, matching `.top-podcast-play` / -duration.
  const topRow = Math.round((mediaHeight - PLAY_MARK_HEIGHT) / 2);
  const bottomRow = mediaHeight - PLAY_MARK_HEIGHT - topRow;

  const playBadge =
    `${tableOpen('style="border-collapse:collapse;"')}<tr>` +
    `<td align="center" valign="middle" width="${PLAY_MARK_WIDTH}" ` +
    `height="${PLAY_MARK_HEIGHT}" style="width:${PLAY_MARK_WIDTH}px;` +
    `height:${PLAY_MARK_HEIGHT}px;line-height:0;font-size:0;">` +
    `<img src="${PLAY_MARK_SRC}" width="${PLAY_MARK_WIDTH}" ` +
    `height="${PLAY_MARK_HEIGHT}" alt="" style="display:block;` +
    `width:${PLAY_MARK_WIDTH}px;height:${PLAY_MARK_HEIGHT}px;border:0;` +
    `outline:none;text-decoration:none;opacity:${PLAY_MARK_OPACITY};" />` +
    "</td></tr></table>";

  const durationChip = podcast.duration
    ? `${tableOpen('style="border-collapse:separate;"')}<tr>` +
      '<td style="padding:2px 6px;border-radius:4px;background-color:#111111;' +
      `color:${WHITE};font-family:${FONT_STACK};font-size:12px;font-weight:600;">` +
      `${esc(podcast.duration)}</td></tr></table>`
    : "&nbsp;";

  /**
   * Outlook only, and byte-for-byte what it rendered before: the VML rect
   * paints the frame at a fixed 550x309 and the overlay rows hold their pixel
   * heights. Word supports none of the fluid technique below, and the shell
   * never reflows in Outlook anyway, so this branch is left exactly as it was.
   */
  const outlookOverlay =
    `${tableOpen(`width="${BODY_WIDTH}" height="${mediaHeight}" style="border-collapse:collapse;"`)}` +
    `<tr><td height="${topRow}" ` +
    `style="height:${topRow}px;font-size:0;line-height:0;">&nbsp;</td></tr>` +
    `<tr><td align="center" valign="middle" height="${PLAY_MARK_HEIGHT}" ` +
    `style="height:${PLAY_MARK_HEIGHT}px;">${playBadge}</td></tr>` +
    `<tr><td align="right" valign="bottom" height="${bottomRow}" ` +
    `style="height:${bottomRow}px;padding:0 10px 10px 0;">${durationChip}</td></tr>` +
    "</table>";

  const outlookMedia =
    "<!--[if gte mso 9]>" +
    `<v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" ` +
    `style="width:${BODY_WIDTH}px;height:${mediaHeight}px;">` +
    `<v:fill type="frame" src="${thumb}" color="#111111" /><v:textbox inset="0,0,0,0">` +
    `${tableOpen(`width="${BODY_WIDTH}" style="border-collapse:collapse;border-radius:8px;"`)}<tr>` +
    `<td background="${thumb}" bgcolor="#111111" ` +
    `width="${BODY_WIDTH}" height="${mediaHeight}" ` +
    `style="width:${BODY_WIDTH}px;height:${mediaHeight}px;background-color:#111111;` +
    `background-image:url('${thumb}');background-position:center center;background-size:cover;` +
    'background-repeat:no-repeat;border-radius:8px;">' +
    outlookOverlay +
    "</td></tr></table>" +
    "</v:textbox></v:rect><![endif]-->";

  /**
   * Everyone else, Outlook excepted — and no media query involved.
   *
   * The artwork is a fluid `<img>`, so the *image* decides the height and the
   * frame is 16:9 at every width, on its own, in any client. The previous
   * background-image cell could not: a background has no intrinsic size, so
   * the box needed a pixel height, and a client that ignored the breakpoint
   * kept the desktop 309px against a ~330px width — the near-square frame.
   *
   * The two overlays keep their positions without `position`, which Gmail
   * strips. Each sits in a `height:0` slot ahead of the image, so it adds
   * nothing to the box, and is pushed onto the artwork with a percentage
   * `padding-top` — a percentage padding resolves against the *width*, which
   * is what makes it track the image.
   *
   * The percentage is the overlay's *top*, worked out from the desktop
   * geometry (`pct`), and nothing is pulled back afterwards. A negative
   * `margin-top` used to do that half of the job, and Gmail drops negative
   * margins — which is what put the duration chip below the artwork instead of
   * inside its corner. Because the offsets are pure percentages of the width
   * while the chip and the mark are a fixed number of pixels tall, the two
   * `.nl-pod-*` classes retune them at the phone breakpoints, where those
   * pixels are a larger share of a smaller frame.
   *
   * Degrades in the right direction: a client that honours none of it shows
   * the badge and chip stacked above the artwork rather than a broken frame.
   */
  const pct = (px: number) => `${((px / BODY_WIDTH) * 100).toFixed(3)}%`;
  const centreLine = pct((mediaHeight - PLAY_MARK_HEIGHT) / 2);
  const bottomEdge = pct(mediaHeight - 30);

  /**
   * `height:0` is the only thing these wrappers declare. They must not set
   * `font-size:0`/`line-height:0` the way a spacer would: both inherit, and
   * the duration chip does not restate its own line height, so a zero would
   * collapse "12:04" to a 4px sliver. The image is `display:block`, so there
   * is no inline gap to suppress either.
   */
  const fluidOverlay = (
    offset: string,
    className: string,
    cell: string,
    body: string,
  ) =>
    '<div style="height:0;">' +
    `<div class="${className}" style="padding-top:${offset};">` +
    `${tableOpen('width="100%" style="border-collapse:collapse;"')}` +
    `<tr><td ${cell}>${body}</td></tr></table>` +
    "</div></div>";

  const fluidMedia =
    "<!--[if !mso]><!-->" +
    `${tableOpen('width="100%" style="border-collapse:collapse;"')}<tr>` +
    '<td bgcolor="#111111" ' +
    'style="padding:0;background-color:#111111;border-radius:8px;">' +
    fluidOverlay(
      centreLine,
      "nl-pod-play",
      'align="center" style="padding:0;"',
      playBadge,
    ) +
    (podcast.duration
      ? fluidOverlay(
          bottomEdge,
          "nl-pod-time",
          'align="right" style="padding:0 10px 0 0;"',
          durationChip,
        )
      : "") +
    `<img src="${thumb}" width="${BODY_WIDTH}" height="${mediaHeight}" ` +
    `alt="${esc(podcast.title)}" style="display:block;width:100%;` +
    `max-width:${BODY_WIDTH}px;height:auto;border:0;border-radius:8px;` +
    'outline:none;text-decoration:none;" />' +
    "</td></tr></table>" +
    "<!--<![endif]-->";

  return (
    `<tr><td class="nl-gutter" style="padding:14px ${BODY_GUTTER}px 14px;">` +
    `${tableOpen(`width="100%" style="border-collapse:collapse;border-bottom:1px solid ${HAIRLINE};"`)}` +
    '<tr><td style="padding-bottom:8px;">' +
    `${headingWithIcon(
      '<img src="https://navbharattimes.indiatimes.com/photo/134333107/pic.jpg" ' +
        'width="18" height="18" alt="" ' +
        'style="display:block;width:18px;height:18px;border:0;outline:none;' +
        'text-decoration:none;" />',
      labels.podcastLabel,
      18,
      RED,
    )}` +
    "</td></tr>" +
    `<tr><td style="padding-bottom:14px;"><a href="${url}" target="_blank" ` +
    'style="display:block;text-decoration:none;">' +
    outlookMedia +
    fluidMedia +
    "</a></td></tr>" +
    // The episode title, under the artwork. `.top-podcast-copy h2` in
    // globals.css (15px / 1.35, weight 700) is the web's treatment of the same
    // line, so it is the one used here too. The row carries the 14px the media
    // row above it already carries, which keeps the section's bottom rule the
    // same distance from the last line of content as before; the cell is a
    // plain table cell at the shell's own width, so a long title simply wraps.
    `<tr><td style="padding-bottom:14px;font-family:${FONT_STACK};font-size:15px;` +
    `line-height:1.35;font-weight:700;color:${BLACK};${BREAK_WORD}">` +
    `${esc(podcast.title)}</td></tr>` +
    "</table></td></tr>"
  );
}

/** One `.news-card`: image, headline, blurb, "पूरी खबर पढ़ें →". */
function renderNewsCard(
  baseUrl: string,
  article: EmailArticle,
  descriptionMax: number,
  labels: EmailLabels,
  isLast: boolean,
): string {
  const url = safeUrl(baseUrl, article.url);
  const readMoreUrl = safeUrl(baseUrl, withArticleUtm(article.url));
  const image = article.image ? esc(absoluteUrl(baseUrl, article.image)) : "";
  const description = clamp(article.description, descriptionMax);

  const imageBlock = image
    ? linkedImage(
        readMoreUrl,
        `<img src="${image}" width="${BODY_WIDTH}" alt="${esc(article.title)}" ` +
          `style="display:block;width:100%;max-width:${BODY_WIDTH}px;height:auto;border:0;` +
          'border-radius:4px;outline:none;text-decoration:none;" />',
      ) + '<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>'
    : "";

  const headline =
    `<h3 class="nl-card-title" style="margin:0 0 6px;font-family:${FONT_STACK};font-size:21px;` +
    `line-height:1.35;font-weight:800;color:${BLACK};${BREAK_WORD}">${esc(article.title)}</h3>`;

  return (
    '<tr><td style="padding:22px 0;' +
    // `.news-card { border-bottom: 1px solid #e7e1dc }` — the grid's 12px gap
    // is added by the spacer row that follows.
    `border-bottom:1px solid ${LIGHT_GRAY};">` +
    imageBlock +
    (url
      ? `<a href="${url}" target="_blank" style="text-decoration:none;color:${BLACK};">${headline}</a>`
      : headline) +
    (description
      ? `<p class="nl-card-text" style="margin:0 0 10px;font-family:${FONT_STACK};` +
        `font-size:14px;line-height:1.55;color:${BLACK};${BREAK_WORD}">${esc(description)}</p>`
      : "") +
    (url
      ? `<a href="${readMoreUrl}" target="_blank" style="font-family:${FONT_STACK};font-size:13px;` +
        `font-weight:700;color:${RED};text-decoration:none;">${esc(labels.readFullStory)} ${ARROW_GLYPH}</a>`
      : "") +
    "</td></tr>" +
    (isLast ? "" : spacer(12))
  );
}

/** `.more-news` — the outlined "और खबरें देखें →" button. */
function renderMoreNews(baseUrl: string, labels: EmailLabels): string {
  return (
    `<tr><td style="padding-top:15px;">` +
    `${tableOpen(
      `width="100%" style="border-collapse:separate;border:2px solid ${RED};border-radius:6px;"`,
    )}<tr><td align="center" style="padding:8px 16px;">` +
    `<a href="${campaignUrl(baseUrl, DEFAULT_FOOTER_LINKS.home)}" target="_blank" ` +
    `style="font-family:${FONT_STACK};font-size:13px;font-weight:800;color:${RED};` +
    `text-decoration:none;">${esc(labels.moreNews)}` +
    `<span style="margin-left:8px;font-size:17px;">${ARROW_GLYPH}</span></a>` +
    "</td></tr></table></td></tr>"
  );
}

/** `.selected-news` — used for both "आज की प्रमुख खबरें" and "पिछले 24 घंटे में". */
function renderNewsSection(
  baseUrl: string,
  heading: string,
  articles: EmailArticle[],
  descriptionMax: number,
  labels: EmailLabels,
  withMoreNews: boolean,
): string {
  if (!articles.length) return "";

  const cards = articles
    .map((article, index) =>
      renderNewsCard(
        baseUrl,
        article,
        descriptionMax,
        labels,
        index === articles.length - 1,
      ),
    )
    .join("");

  return (
    `<tr><td class="nl-gutter" style="padding:0 ${BODY_GUTTER}px 20px;` +
    `border-top:1px solid ${LIGHT_GRAY};">` +
    `${tableOpen('width="100%" style="border-collapse:collapse;"')}` +
    `<tr><td class="nl-section-label" style="padding:14px 0 8px;font-family:${FONT_STACK};` +
    `font-size:18px;font-weight:800;color:${RED};">${esc(heading)}</td></tr>` +
    cards +
    (withMoreNews ? renderMoreNews(baseUrl, labels) : "") +
    "</table></td></tr>"
  );
}

/* --- footer -------------------------------------------------------------- */

/** One `.nbt-store-button`. */
function storeButton(
  href: string,
  icon: string,
  small: string,
  name: string,
): string {
  return (
    `${tableOpen(
      `width="100%" style="border-collapse:separate;border:1px solid ${LIGHT_GRAY};` +
        `border-radius:6px;background-color:${WHITE};"`,
    )}<tr><td style="padding:6px 7px;">` +
    `<a href="${href}" target="_blank" style="text-decoration:none;color:${BLACK};">` +
    `${tableOpen('style="border-collapse:collapse;"')}<tr>` +
    `<td valign="middle" style="padding-right:5px;line-height:0;font-size:0;">${icon}</td>` +
    `<td valign="middle" style="font-family:${FONT_STACK};color:${BLACK};">` +
    '<span style="display:block;font-size:6.5px;font-weight:600;line-height:1.2;' +
    `letter-spacing:0.04em;">${esc(small)}</span>` +
    `<span style="display:block;font-size:9.5px;font-weight:700;line-height:1.15;` +
    `white-space:nowrap;">${esc(name)}</span></td>` +
    "</tr></table></a></td></tr></table>"
  );
}

/**
 * One store badge as a linked image — the `<td>` included, because the pair
 * sits in a row of its own inside the app column.
 *
 * No responsive class: the two badges plus their 6px gap measure 222px, which
 * still fits the app column after it goes full width on a phone, so they are
 * the one part of the footer that needs no breakpoint.
 */
function storeBadge(
  href: string,
  src: string,
  alt: string,
  width: number,
): string {
  return (
    `<td valign="top" width="${width}" style="width:${width}px;">` +
    `<a href="${href}" target="_blank" style="text-decoration:none;">` +
    `<img src="${esc(src)}" alt="${esc(alt)}" width="${width}" ` +
    `height="${STORE_BADGE_HEIGHT}" ` +
    `style="display:block;width:100%;max-width:${width}px;height:auto;` +
    'border:0;outline:none;text-decoration:none;" /></a></td>'
  );
}

/**
 * The mark inside one `socialChip`: 25px square, cropped to a circle.
 *
 * Every entry in `SOCIAL_ICON_SRC` is square artwork, so one size and one
 * radius covers all five and none of them is stretched to get there. The
 * circle trims the corners of the two full-bleed tiles (X, Instagram) and
 * costs the three transparent ones nothing.
 */
function socialImage(src: string, alt: string): string {
  return (
    `<img src="${esc(src)}" alt="${esc(alt)}" width="25" height="25" ` +
    'style="display:block;width:25px;height:25px;border:0;outline:none;' +
    'text-decoration:none;border-radius:50%;" />'
  );
}

/**
 * One `.nbt-social-icons a` — a 25px slot holding one mark.
 *
 * Nothing is painted behind it: the artwork carries each brand's own colour,
 * so the chip that used to fill a circle with `bgcolor` would only show as a
 * ring around the logo sitting on it.
 */
function socialChip(href: string, icon: string): string {
  return (
    '<td valign="top" style="padding-right:3px;">' +
    `${tableOpen('style="border-collapse:separate;"')}<tr>` +
    '<td align="center" valign="middle" width="25" height="25" ' +
    'style="width:25px;height:25px;line-height:0;font-size:0;">' +
    `<a href="${href}" target="_blank" style="display:block;line-height:0;font-size:0;` +
    'text-decoration:none;">' +
    `${icon}</a></td></tr></table></td>`
  );
}

/** `.nbt-footer` — brand | app | social, the rule, the links row, copyright. */
export function renderFooter(
  baseUrl: string,
  links: EmailFooterLinks,
  labels: EmailLabels,
): string {
  // `.nbt-footer-main` is a 0.85fr / 1.6fr / 1.15fr grid with a 14px gap inside
  // an 18px gutter: 562 - 28 = 534 split three ways.
  const brandWidth = 126;
  const appWidth = 237;
  const followWidth = 171;

  const socialRow =
    `${tableOpen('class="nl-social-row" style="border-collapse:collapse;"')}<tr>` +
    socialChip(
      campaignUrl(baseUrl, links.youtube),
      socialImage(SOCIAL_ICON_SRC.youtube, "YouTube"),
    ) +
    socialChip(
      campaignUrl(baseUrl, links.x),
      socialImage(SOCIAL_ICON_SRC.x, "X"),
    ) +
    socialChip(
      campaignUrl(baseUrl, links.facebook),
      socialImage(SOCIAL_ICON_SRC.facebook, "Facebook"),
    ) +
    socialChip(
      campaignUrl(baseUrl, links.instagram),
      socialImage(SOCIAL_ICON_SRC.instagram, "Instagram"),
    ) +
    socialChip(
      campaignUrl(baseUrl, links.whatsapp),
      socialImage(SOCIAL_ICON_SRC.whatsapp, "WhatsApp"),
    ) +
    "</tr></table>";

  const separator =
    '<td class="nl-fsep" style="padding:0 8px;">' +
    `${tableOpen('style="border-collapse:collapse;"')}<tr>` +
    `<td width="1" height="11" bgcolor="${LIGHT_GRAY}" ` +
    `style="width:1px;height:11px;font-size:0;line-height:0;background-color:${LIGHT_GRAY};">` +
    "&nbsp;</td></tr></table></td>";

  const linksRow =
    `${tableOpen('class="nl-flinks" style="border-collapse:collapse;"')}<tr>` +
    `<td class="nl-flink" valign="middle">` +
    `<a href="${campaignUrl(baseUrl, links.otherNewsletters)}" target="_blank" ` +
    `style="text-decoration:none;color:${BLACK};">` +
    `${tableOpen('class="nl-flink-inner" style="border-collapse:collapse;"')}<tr>` +
    `<td valign="middle" style="padding-right:5px;line-height:0;font-size:0;">` +
    `${iconNewspaper({ size: 12, color: BLACK })}</td>` +
    `<td valign="middle" style="font-family:${FONT_STACK};font-size:11px;font-weight:800;` +
    `color:${BLACK};">${esc(labels.otherNewsletters)}</td></tr></table></a></td>` +
    separator +
    `<td class="nl-flink" valign="middle">` +
    `<a href="${safeUrl(baseUrl, links.unsubscribe)}" ` +
    `style="font-family:${FONT_STACK};font-size:10.5px;font-weight:600;color:${GRAY};` +
    `text-decoration:underline;">${esc(labels.unsubscribe)}</a></td>` +
    "</tr></table>";

  const feedbackPill =
    `${tableOpen(
      `class="nl-feedback-pill" style="border-collapse:separate;` +
        `border:1px solid ${RED};border-radius:999px;"`,
    )}` +
    '<tr><td style="padding:7px 13px;">' +
    `<a href="${campaignUrl(baseUrl, links.feedback)}" target="_blank" ` +
    `style="text-decoration:none;color:${RED};">` +
    `${tableOpen('style="border-collapse:collapse;"')}<tr>` +
    `<td valign="middle" style="padding-right:6px;line-height:0;font-size:0;">` +
    `${iconComment({ size: 12, color: RED })}</td>` +
    `<td valign="middle" style="font-family:${FONT_STACK};font-size:11px;font-weight:700;` +
    `color:${RED};white-space:nowrap;">${esc(labels.feedback)}</td>` +
    '<td valign="middle" style="padding-left:6px;line-height:0;font-size:0;">' +
    `${iconArrowRight({ size: 11, color: RED })}</td>` +
    "</tr></table></a></td></tr></table>";

  return (
    `<tr><td style="background-color:${WHITE};">` +
    // --- top: brand | app download | social ---
    `${tableOpen('width="100%" style="border-collapse:collapse;"')}` +
    '<tr><td class="nl-footer-main" style="padding:16px 18px;">' +
    `${tableOpen('width="100%" style="border-collapse:collapse;"')}<tr>` +
    `<td class="nl-footer-cell" valign="middle" align="center" width="${brandWidth}" ` +
    `style="width:${brandWidth}px;">` +
    `<a href="${campaignUrl(baseUrl, links.home)}" target="_blank">` +
    `<img src="${esc(absoluteUrl(baseUrl, LOGO_PATH))}" width="118" alt="NBT" ` +
    'style="display:block;width:100%;max-width:118px;height:auto;border:0;outline:none;' +
    'text-decoration:none;" /></a></td>' +
    '<td class="nl-footer-gap" width="14" style="width:14px;font-size:0;line-height:0;">' +
    "&nbsp;</td>" +
    `<td class="nl-footer-col nl-footer-app" valign="middle" width="${appWidth}" ` +
    `style="width:${appWidth}px;` +
    `border-left:1px solid ${LIGHT_GRAY};padding-left:14px;">` +
    `${headingWithIcon(
      iconMobile({ size: 13, color: RED }),
      labels.appHeading,
      13,
      BLACK,
      "nl-app-heading",
    )}` +
    `<p class="nl-app-blurb" style="margin:5px 0 9px;font-family:${FONT_STACK};` +
    `font-size:10.5px;font-weight:500;` +
    `line-height:1.6;color:${GRAY};">${esc(labels.appBlurb)}</p>` +
    `${tableOpen('class="nl-store-row" width="100%" style="border-collapse:collapse;"')}<tr>` +

    // '<td valign="top" width="108" style="width:108px;">' +
    // `${storeButton(safeUrl(baseUrl, links.playStore), iconGooglePlay(), "GET IT ON", "Google Play")}</td>` +
    // '<td width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>' +
    // '<td valign="top" width="108" style="width:108px;">' +
    // `${storeButton(safeUrl(baseUrl, links.appStore), iconApple({ size: 15, color: "#111317" }), "Download on the", "App Store")}</td>` +
    // "</tr></table></td>" +

    storeBadge(
      campaignUrl(baseUrl, links.playStore),
      PLAY_STORE_BADGE_SRC,
      "Get it on Google Play",
      PLAY_BADGE_WIDTH,
    ) +
    '<td width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>' +
    storeBadge(
      campaignUrl(baseUrl, links.appStore),
      APP_STORE_BADGE_SRC,
      "Download on the App Store",
      APP_BADGE_WIDTH,
    ) +
    // Closes the badge row, the badge table and the app column. Without these
    // three the "follow" column below nests inside the badge row instead of
    // sitting beside it, and the footer loses its three-column composition.
    "</tr></table></td>" +
    '<td class="nl-footer-gap" width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>' +
    `<td class="nl-footer-col nl-footer-follow" valign="middle" width="${followWidth}" ` +
    `style="width:${followWidth}px;` +
    `border-left:1px solid ${LIGHT_GRAY};padding-left:14px;">` +
    `<div style="margin:0 0 9px;font-family:${FONT_STACK};font-size:13px;font-weight:800;` +
    `line-height:1.3;color:${BLACK};">${esc(labels.followHeading)}</div>` +
    socialRow +
    "</td></tr></table></td></tr>" +
    // --- `.nbt-footer-rule` ---
    '<tr><td class="nl-footer-rule" style="padding:0 18px;">' +
    `${tableOpen('width="100%" style="border-collapse:collapse;"')}<tr>` +
    `<td class="nl-footer-rule-line" height="1" bgcolor="${LIGHT_GRAY}" ` +
    `style="height:1px;font-size:0;line-height:0;background-color:${LIGHT_GRAY};">&nbsp;</td>` +
    "</tr></table></td></tr>" +
    // --- `.nbt-footer-lower` ---
    '<tr><td class="nl-footer-lower" style="padding:9px 18px;">' +
    `${tableOpen('width="100%" style="border-collapse:collapse;"')}<tr>` +
    `<td class="nl-footer-links" valign="middle" align="left">${linksRow}</td>` +
    `<td class="nl-footer-feedback" valign="middle" align="right">${feedbackPill}</td>` +
    "</tr></table></td></tr>" +
    // --- `.nbt-footer-copyright` ---
    '<tr><td class="nl-footer-copy" align="center" style="padding:0 18px 14px;' +
    `font-family:${FONT_STACK};font-size:10px;font-weight:500;color:${GRAY};">` +
    `${esc(labels.copyright)}</td></tr>` +
    "</table></td></tr>"
  );
}

/* =========================================================================
   DOCUMENT
========================================================================= */

/**
 * The only rules that cannot be inlined. Clients that strip `<style>` keep the
 * 600px composition, which is the design's desktop state — nothing breaks, it
 * just stops reflowing.
 *
 * Two breakpoints, mirroring the two in globals.css (the 700px mobile block
 * and the 400px small-phone step) but measured against the 600px shell rather
 * than the viewport, so 620px is where the shell stops fitting a phone.
 *
 * What an inbox forces to differ from the web:
 *
 *   - Nothing for the podcast artwork or the red rule. Both used to need a
 *     breakpoint and no longer do: the artwork is a fluid `<img>` that carries
 *     16:9 by itself, and the rule is a border rather than a filled cell. A
 *     client that strips this whole block still renders both correctly, which
 *     a media query could never promise. See `renderPodcast`/`renderRedLine`.
 *   - The footer becomes one column. On the web the three are `fr` units
 *     that shrink (`.nbt-footer-main`, tightened again at 599px); here they
 *     are fixed-pixel `<td>`s totalling 562px, which no phone can show, so
 *     they stack: app, follow, then the rule, the links one per line, the
 *     feedback pill and the copyright, everything centred. Two things do
 *     not come along - the logo (`.nl-footer-cell`) and the app blurb
 *     (`.nl-app-blurb`), which a phone is better off without. Desktop keeps
 *     all three columns and both: every rule below is inside a media query.
 */
/**
 * The footer's own responsive rules, shared with `./compose`.
 *
 * Both composers emit the same footer, so both need the same breakpoints;
 * holding the CSS in one place is what stops the two drifting apart.
 */
export const FOOTER_RESPONSIVE_620 =
  // footer — one column on a phone: app, then follow, then the rule,
  // the links, the feedback pill and the copyright. The logo and the app
  // blurb are the two things dropped; everything else is the desktop
  // footer restacked, centred, and free of any width a 320px screen
  // cannot hold.
  "  .nl-footer-main{padding:14px 12px !important;}\n" +
  "  .nl-footer-cell,.nl-app-blurb{display:none !important;}\n" +
  "  .nl-footer-gap{display:none !important;}\n" +
  "  .nl-footer-col{display:block !important;width:100% !important;" +
  "border-left:0 !important;padding-left:0 !important;text-align:center !important;}\n" +
  "  .nl-footer-app{padding-bottom:14px !important;}\n" +
  // The divider between the two columns, now that the logo above them is
  // gone and the app column is the first thing in the footer.
  `  .nl-footer-follow{border-top:1px solid ${LIGHT_GRAY} !important;` +
  "padding-top:14px !important;}\n" +
  // A table ignores its parent's `text-align`, so each one centres by its
  // own margins: the two headings, the badges, the chips, a link's icon
  // + label, and the pill.
  "  .nl-app-heading,.nl-store-row,.nl-social-row,.nl-flinks,"+
  ".nl-flink-inner,.nl-feedback-pill{margin:0 auto !important;}\n" +
  // `width:100%` would spread the two badges to the column's edges.
  "  .nl-store-row{width:auto !important;}\n" +
  "  .nl-footer-rule{padding:16px 16px 0 !important;}\n" +
  // An explicit height *and* a background, because the cell's own
  // content is a zero-sized `&nbsp;` at `font-size:0` - without both,
  // the divider collapses to nothing on a phone.
  `  .nl-footer-rule-line{height:2px !important;line-height:2px !important;` +
  `font-size:2px !important;background-color:${LIGHT_GRAY} !important;}\n` +
  "  .nl-footer-lower{padding:14px 16px !important;}\n" +
  "  .nl-footer-links,.nl-footer-feedback{display:block !important;width:100% !important;" +
  "text-align:center !important;}\n" +
  "  .nl-footer-feedback{padding-top:14px !important;}\n" +
  // The links row keeps all three abreast, with the same `|` between
  // them as on desktop, and `width:auto` lets the table shrink to that
  // group so the `margin:0 auto` above can centre it. Measured in
  // Nirmala UI the three read 70.3 + 62.6 + 78.1px, which with the icon
  // and the two rules is ~262px against the 296px a 320px screen leaves
  // — so `nowrap` is a guarantee rather than a squeeze.
  "  .nl-flinks{width:auto !important;}\n" +
  "  .nl-flink{white-space:nowrap !important;}\n" +
  "  .nl-footer-copy{padding:4px 16px 18px !important;line-height:1.5 !important;}\n";

/** The 400px step of the same footer rules. */
export const FOOTER_RESPONSIVE_400 =
  "  .nl-footer-main{padding:12px 10px !important;}\n" +
  "  .nl-footer-rule{padding:14px 12px 0 !important;}\n" +
  "  .nl-footer-lower{padding:12px !important;}\n" +
  "  .nl-fsep{padding:0 6px !important;}\n" +
  "  .nl-footer-copy{padding:4px 12px 16px !important;line-height:1.5 !important;}\n";

function renderStyles(): string {
  return (
    '<style type="text/css">\n' +
    "body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}\n" +
    "table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}\n" +
    "img{-ms-interpolation-mode:bicubic;border:0;line-height:100%;outline:none;text-decoration:none;}\n" +
    "body{margin:0 !important;padding:0 !important;width:100% !important;}\n" +
    "a{text-decoration:none;}\n" +
    // `.page { padding: 0 }` and the borderless `.newsletter` of the 700px block.
    "@media only screen and (max-width:620px){\n" +
    "  .nl-page{padding:0 !important;}\n" +
    "  .nl-shell{width:100% !important;max-width:100% !important;" +
    "border-left:0 !important;border-right:0 !important;}\n" +
    "  .nl-gutter{padding-left:16px !important;padding-right:16px !important;}\n" +
    // recap box — the 36px inset and 20px padding are too much of a 360px screen
    "  .nl-recap-box{padding:14px 16px 12px !important;}\n" +
    "  .nl-recap-text{font-size:15px !important;}\n" +
    "  .nl-hero-title{font-size:21px !important;}\n" +
    "  .nl-hero-text{font-size:14px !important;line-height:1.6 !important;}\n" +
    "  .nl-hero-link{font-size:13px !important;}\n" +
    // Nothing here for the podcast artwork: it holds 16:9 on its own now, at
    // any width and with no breakpoint. See `renderPodcast`.
    // podcast overlays — the mark and the chip are a fixed pixel height, so
    // their percentage top has to come up as the frame narrows.
    "  .nl-pod-play{padding-top:22% !important;}\n" +
    "  .nl-pod-time{padding-top:48% !important;}\n" +
    FOOTER_RESPONSIVE_620 +
    "}\n" +
    // The 400px step: 12px gutters and one notch off the type scale, exactly
    // as the small-phone block in globals.css does it.
    "@media only screen and (max-width:400px){\n" +
    "  .nl-gutter{padding-left:12px !important;padding-right:12px !important;}\n" +
    "  .nl-recap-box{padding:12px 13px 10px !important;}\n" +
    "  .nl-recap-text{font-size:14px !important;}\n" +
    "  .nl-section-label{font-size:16px !important;}\n" +
    "  .nl-hero-title{font-size:19px !important;}\n" +
    "  .nl-card-title{font-size:19px !important;}\n" +
    "  .nl-pod-play{padding-top:20% !important;}\n" +
    "  .nl-pod-time{padding-top:46% !important;}\n" +
    FOOTER_RESPONSIVE_400 +
    "}\n" +
    "</style>"
  );
}

/** Inbox preview line — hidden in the body itself. */
function renderPreheader(text: string): string {
  if (!text) return "";
  return (
    '<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;' +
    `mso-hide:all;font-size:1px;line-height:1px;color:${CREAM};">${esc(text)}` +
    "&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>"
  );
}

/**
 * Render one issue as a complete, self-contained HTML document, ready to hand
 * to an email provider.
 *
 * Per-recipient values are left as `{{tokens}}` (see `EMAIL_TOKENS`) so the
 * issue can be rendered once, stored once, and personalised at send time — the
 * shape `deliver.ts` already assumes.
 */
export function renderNewsletterEmail(data: NewsletterEmailData): string {
  const baseUrl = data.baseUrl.replace(/\/+$/, "");
  const labels: EmailLabels = { ...DEFAULT_LABELS, ...data.labels };
  const subscriber = data.subscriberToken ?? EMAIL_TOKENS.SUBSCRIBER;

  // The two footer links that act on *this* app rather than linking out. Both
  // resolve to a real one-click URL by default; an explicit `footerLinks` entry
  // (or `unsubscribeUrl`, e.g. the `{{unsubscribe_url}}` token `deliver.ts`
  // substitutes) still wins.
  const links: EmailFooterLinks = {
    ...DEFAULT_FOOTER_LINKS,
    ...data.footerLinks,
    subscribe:
      data.footerLinks?.subscribe || buildSubscribeUrl({ baseUrl, subscriber }),
    unsubscribe:
      data.unsubscribeUrl ||
      data.footerLinks?.unsubscribe ||
      buildUnsubscribeUrl({ baseUrl, subscriber }),
  };
  const preheader = data.preheader ?? data.recap[0] ?? "";

  const body =
    `${tableOpen(
      `class="nl-shell" width="${SHELL_WIDTH}" align="center" ` +
        `style="width:${SHELL_WIDTH}px;max-width:${SHELL_WIDTH}px;border-collapse:collapse;` +
        `background-color:${WHITE};border:1px solid ${SHELL_BORDER};"`,
    )}` +
    renderMasthead(baseUrl) +
    renderDate(data.date) +
    renderRedLine() +
    renderGreeting(labels.greeting) +
    renderRecap(labels.recapHeading, data.recap ?? []) +
    renderHero(baseUrl, data.topStory, labels) +
    renderPodcast(baseUrl, data.podcast, labels) +
    renderNewsSection(
      baseUrl,
      labels.selectedNewsHeading,
      data.selectedNews ?? [],
      SELECTED_DESCRIPTION_MAX,
      labels,
      true,
    ) +
    renderNewsSection(
      baseUrl,
      labels.past24HoursHeading,
      data.past24Hours ?? [],
      PAST_DESCRIPTION_MAX,
      labels,
      false,
    ) +
    renderFooter(baseUrl, links, labels) +
    "</table>";

  return (
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ' +
    '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" lang="hi" xml:lang="hi">\n' +
    "<head>\n" +
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    '<meta name="x-apple-disable-message-reformatting" />\n' +
    '<meta name="color-scheme" content="light only" />\n' +
    '<meta name="supported-color-schemes" content="light only" />\n' +
    `<title>${esc(labels.recapHeading)} — ${esc(data.date)}</title>\n` +
    "<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/>" +
    "<o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->\n" +
    `<link href="${FONT_HREF}" rel="stylesheet" type="text/css" />\n` +
    `${renderStyles()}\n` +
    "</head>\n" +
    `<body style="margin:0;padding:0;background-color:${CREAM};color:${BLACK};` +
    `font-family:${FONT_STACK};">\n` +
    renderPreheader(preheader) +
    // `.page { padding: 30px 15px; background: var(--cream) }`
    `${tableOpen(
      `width="100%" bgcolor="${CREAM}" style="width:100%;border-collapse:collapse;` +
        `background-color:${CREAM};"`,
    )}` +
    '<tr><td class="nl-page" align="center" style="padding:30px 15px;">\n' +
    body +
    "\n</td></tr></table>\n</body>\n</html>"
  );
}
