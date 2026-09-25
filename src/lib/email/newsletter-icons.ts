/**
 * Icons for the email template.
 *
 * The web newsletter draws these with `react-icons` (`BsStars`, `FaPodcast`,
 * `FaYoutube`, …) and Font Awesome web-font glyphs (`fa-pen-to-square`,
 * `fa-check`, `fa-xmark`, `fa-question`). Neither survives an inbox: an icon
 * web font is never loaded by Gmail or Outlook, and a React component tree has
 * no meaning in an HTML email. So each icon is re-drawn here as plain inline
 * SVG markup — no package, no runtime, no external request.
 *
 * Two deliberate exceptions, both forced by the client rather than the design:
 *
 *   1. Gmail strips `<svg>` from message bodies. Where the icon carries the
 *      meaning rather than decorating it — the podcast play badge, the
 *      "read more" arrows — a Unicode glyph
 *      is used instead, because it renders everywhere. The web design already
 *      writes the play badge and the arrows as literal "▶" and "→" characters,
 *      so this matches it exactly rather than approximating it.
 *   2. Everywhere else (section headings, the footer's brand marks) an SVG is
 *      used, and the surrounding heading text or brand-coloured chip is what
 *      the reader still sees in Gmail if the SVG is dropped.
 *
 * If a delivery run later needs pixel-identical icons in Gmail, this file is
 * the single swap point: return `<img src="https://…/icon.png">` from these
 * helpers and nothing else in the template changes.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

interface IconOptions {
  size?: number;
  color?: string;
}

/** Stroke-drawn icon — the outline style react-icons uses for these marks. */
function strokeIcon(body: string, { size = 16, color = 'currentColor' }: IconOptions = {}): string {
  return (
    `<svg xmlns="${SVG_NS}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" style="display:inline-block;vertical-align:middle;">${body}</svg>`
  );
}

/** Solid icon — brand marks and the sparkle. */
function solidIcon(body: string, { size = 16, color = 'currentColor' }: IconOptions = {}): string {
  return (
    `<svg xmlns="${SVG_NS}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="${color}" style="display:inline-block;vertical-align:middle;">${body}</svg>`
  );
}

/* ---------------------------------------------------------------------------
   Newsletter body
--------------------------------------------------------------------------- */

/** `BsStars` — the big + small sparkle beside "आज का न्यूज़ रीकैप". */
export function iconStars(options?: IconOptions): string {
  return solidIcon(
    '<path d="M11 2.5 13.1 8.9 19.5 11 13.1 13.1 11 19.5 8.9 13.1 2.5 11 8.9 8.9Z"/>' +
      '<path d="M18.6 14.4 19.5 16.5 21.6 17.4 19.5 18.3 18.6 20.4 17.7 18.3 15.6 17.4 17.7 16.5Z"/>',
    options
  );
}

/** `fa-pen-to-square` — the byline mark on the top story. */
export function iconPen(options?: IconOptions): string {
  return strokeIcon(
    '<path d="M20.5 13.2V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2h5.8"/>' +
      '<path d="M18.4 2.6 21.4 5.6 12 15 8.2 15.8 9 12Z"/>',
    options
  );
}

/** `FaPodcast` — the microphone beside "आज का पॉडकास्ट". */
export function iconMic(options?: IconOptions): string {
  return strokeIcon(
    '<rect x="9" y="2" width="6" height="11" rx="3"/>' +
      '<path d="M5 10.5a7 7 0 0 0 14 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/>',
    options
  );
}

/* ---------------------------------------------------------------------------
   Footer
--------------------------------------------------------------------------- */

/** `FaMobileScreenButton` — heading mark on "NBT ऐप डाउनलोड करें". */
export function iconMobile(options?: IconOptions): string {
  return strokeIcon(
    '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10.5 18.3h3"/>',
    options
  );
}

/** `FaRegNewspaper` — "अन्य न्यूज़लेटर". */
export function iconNewspaper(options?: IconOptions): string {
  return strokeIcon(
    '<path d="M3.5 5.5h13v13h-13z"/><path d="M16.5 9h4v7.5a2 2 0 0 1-4 0"/>' +
      '<path d="M6.5 9h7M6.5 12h7M6.5 15h4"/>',
    options
  );
}

/** `FaRegCommentDots` — the "अपनी राय दें" pill. */
export function iconComment(options?: IconOptions): string {
  return strokeIcon(
    '<path d="M21 11.5c0 3.9-4 7-9 7a11 11 0 0 1-2.9-.4L4 20l1.4-3.4A6.4 6.4 0 0 1 3 11.5c0-3.9 4-7 9-7s9 3.1 9 7Z"/>' +
      '<path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/>',
    options
  );
}

/** `FaArrowRightLong` — trailing arrow on the feedback pill. */
export function iconArrowRight(options?: IconOptions): string {
  return strokeIcon('<path d="M3 12h16.5"/><path d="M14 6.5 19.5 12 14 17.5"/>', options);
}

/**
 * `FaGooglePlay`, on the four-stop brand gradient `Footer.tsx` declares as
 * `<linearGradient id="nbt-play-gradient">`. The gradient is re-declared
 * inline here so the icon stays self-contained.
 */
export function iconGooglePlay({ size = 15 }: IconOptions = {}): string {
  const gradientId = 'nbt-play-gradient';
  return (
    `<svg xmlns="${SVG_NS}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    'style="display:inline-block;vertical-align:middle;">' +
    `<defs><linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">` +
    '<stop offset="0%" stop-color="#00a0ff"/><stop offset="34%" stop-color="#00e676"/>' +
    '<stop offset="67%" stop-color="#ffce00"/><stop offset="100%" stop-color="#ff3a44"/>' +
    '</linearGradient></defs>' +
    `<path fill="url(#${gradientId})" d="M3.6 2.1 15.1 12 3.6 21.9Z"/>` +
    `<path fill="url(#${gradientId})" d="M16.4 10.1 20.6 12 16.4 13.9 14.2 12Z"/>` +
    '</svg>'
  );
}

/** `FaApple` — monochrome #111317, the colour `.nbt-store-apple svg` sets. */
export function iconApple(options?: IconOptions): string {
  return solidIcon(
    '<path d="M16.4 12.5c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7c-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2.1 2.5 2 1 0 1.4-.6 2.6-.6s1.5.6 2.6.6c1.1 0 1.8-1 2.4-2 .8-1.1 1.1-2.2 1.1-2.3 0 0-2.1-.8-2.1-3Z"/>' +
      '<path d="M14.2 6.3c.5-.7.9-1.6.8-2.5-.8 0-1.8.5-2.4 1.2-.5.6-1 1.6-.8 2.5.9.1 1.8-.5 2.4-1.2Z"/>',
    options
  );
}

/* --- social chips: white mark on the brand-coloured circle ---------------- */

/** `FaYoutube` — white play badge; its notch shows the chip's red through. */
export function iconYoutube({ size = 12, color = '#ffffff' }: IconOptions = {}): string {
  return solidIcon(
    '<path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.5 12 4.5 12 4.5s-7 0-8.9.6A3 3 0 0 0 1 7.2 31 31 0 0 0 .4 12 31 31 0 0 0 1 16.8a3 3 0 0 0 2.1 2.1c1.9.6 8.9.6 8.9.6s7 0 8.9-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.6 12 31 31 0 0 0 23 7.2ZM9.8 15.5v-7l6 3.5Z"/>',
    { size, color }
  );
}

/** `FaXTwitter`. */
export function iconX({ size = 12, color = '#ffffff' }: IconOptions = {}): string {
  return solidIcon(
    '<path d="M3.4 3h4.3l4.5 6.1L17.5 3h3.3l-6.4 7.5L21.4 21h-4.3l-4.8-6.5L6.7 21H3.4l6.8-8Z"/>',
    { size, color }
  );
}

/** `FaFacebookF`. */
export function iconFacebook({ size = 12, color = '#ffffff' }: IconOptions = {}): string {
  return solidIcon(
    '<path d="M13.4 22v-8.2h2.7l.4-3.2h-3.1V8.5c0-.9.3-1.6 1.6-1.6h1.7V4.1c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2v2.4H7.4v3.2h2.8V22Z"/>',
    { size, color }
  );
}

/** `FaInstagram` — outline camera, so it reads on the gradient chip. */
export function iconInstagram({ size = 12, color = '#ffffff' }: IconOptions = {}): string {
  return (
    `<svg xmlns="${SVG_NS}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    'style="display:inline-block;vertical-align:middle;">' +
    '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>' +
    `<circle cx="17.3" cy="6.7" r="1" fill="${color}" stroke="none"/></svg>`
  );
}

/** `FaWhatsapp`. */
export function iconWhatsapp({ size = 12, color = '#ffffff' }: IconOptions = {}): string {
  return solidIcon(
    '<path d="M12 2.8a9 9 0 0 0-7.7 13.7L3 21.2l4.9-1.3A9 9 0 1 0 12 2.8Zm0 16.4a7.4 7.4 0 0 1-3.8-1l-.3-.2-2.8.7.8-2.7-.2-.3a7.4 7.4 0 1 1 6.3 3.5Z"/>' +
      '<path d="M9.3 7.9h.6c.2 0 .4 0 .6.5l.8 1.9c.1.2 0 .4-.1.6l-.4.5c-.1.2-.2.3 0 .6.5.9 1.3 1.6 2.2 2 .3.2.5.1.6 0l.6-.7c.2-.2.4-.2.6-.1l1.8.9c.2.1.4.3.3.5-.2 1-1 1.7-1.9 1.7-3 0-6.3-3.3-6.5-6.3 0-.7.1-1.4.3-1.8.1-.2.3-.3.5-.3Z"/>',
    { size, color }
  );
}

/* ---------------------------------------------------------------------------
   Unicode glyphs — see the note at the top of this file
--------------------------------------------------------------------------- */

/** The design already writes these as literal characters in `page.tsx`. */
export const PLAY_GLYPH = '&#9654;';
export const ARROW_GLYPH = '&#8594;';
