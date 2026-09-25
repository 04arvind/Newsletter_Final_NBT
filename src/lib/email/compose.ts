/**
 * The pipeline's composer — `src/lib/pipeline/assemble.ts` and the
 * `send-newsletter` cron build an issue from a flat list of curated items
 * rather than from the full `NewsletterEmailData` shape, so they render here
 * instead of through `./newsletter-template`.
 *
 * The chrome is the same either way: this mirrors the header stack in
 * `src/app/page.tsx` — masthead, right-aligned date, the 3px `.red-line`, then
 * the red `सुप्रभात` greeting — and gives every section heading the red 800
 * weight that `.section-label` and `.selected-news .heading-wrapper h4` carry
 * on the web. A reader who opens the page and the mail side by side should not
 * be able to tell which renderer produced which.
 */

import { formatNewsletterDate } from '../newsletter-presentation'
import { withArticleUtm } from './article-utm'
import { withCampaignUtm } from './campaign-utm'
import {
  DEFAULT_FOOTER_LINKS,
  DEFAULT_LABELS,
  FOOTER_RESPONSIVE_400,
  FOOTER_RESPONSIVE_620,
  renderFooter,
} from './newsletter-template'
import { EMAIL_TOKENS } from './newsletter-template.types'

/* --- design tokens (globals.css :root, same values as ./newsletter-template) */

const RED = '#d91f26'
const BLACK = '#111317'
const GRAY = '#666666'
const LIGHT_GRAY = '#e7e1dc'
const CREAM = '#f7f3ee'
const SOFT_RED = '#fff2f0'
const WHITE = '#ffffff'
const SHELL_BORDER = '#eeeeee'

/** `.newsletter { max-width: 600px }`. */
const SHELL_WIDTH = 600
/** `.masthead` / `.header-date` / `.red-line` gutter. */
const HEADER_GUTTER = 36
/** `.top-podcast` / `.selected-news` gutter. */
const BODY_GUTTER = 25

const FONT_STACK =
  "'Poppins','Noto Sans Devanagari','Nirmala UI','Kohinoor Devanagari',Arial,sans-serif"

/**
 * The long-token guard `globals.css` applies to the headline and copy
 * selectors. Inlined, and with the legacy `word-wrap` spelling first, because
 * Outlook needs that one — a bare URL in a curated title would otherwise
 * stretch the shell past the width of the phone reading it.
 */
const BREAK_WORD = 'word-wrap: break-word; overflow-wrap: break-word;'

/** Absolute, because an inbox has no document base to resolve `/public` against. */
const LOGO_URL =
  'https://static.langimg.com/thumb/119164302/navbharat-times.jpg?width=366&resizemode=4'

interface CuratedItem {
  title: string
  summary: string
  url: string
  source?: string
}

interface FeaturedPodcast {
  title: string
  summary: string
  url: string
}

interface ComposeParams {
  items: CuratedItem[]
  featuredPodcast?: FeaturedPodcast | null
  /** Defaults to today, formatted the way the page's `.header-date` is. */
  date?: string
}

/** Curated copy is model output, so it is escaped rather than trusted as HTML. */
function esc(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The rules an inline `style` cannot express, kept identical in intent to
 * `./newsletter-template`'s `renderStyles` so both editions reflow the same
 * way: the shell goes full width below 620px, the 36px/25px gutters drop to
 * 16px and then to 12px, and the type scale steps down once.
 */
function responsiveStyles(): string {
  return `
        <style type="text/css">
          body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
          table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
          img{-ms-interpolation-mode:bicubic;border:0;line-height:100%;outline:none;text-decoration:none;}
          body{margin:0 !important;padding:0 !important;width:100% !important;}
          @media only screen and (max-width:620px){
            .nl-page{padding:0 !important;}
            .nl-shell{width:100% !important;max-width:100% !important;border-left:0 !important;border-right:0 !important;}
            .nl-gutter{padding-left:16px !important;padding-right:16px !important;}
            .nl-panel{padding:14px 16px 12px !important;}
${FOOTER_RESPONSIVE_620}          }
          @media only screen and (max-width:400px){
            .nl-gutter{padding-left:12px !important;padding-right:12px !important;}
            .nl-panel{padding:12px 13px 10px !important;}
            .nl-section-label{font-size:16px !important;}
            .nl-card-title{font-size:16px !important;}
${FOOTER_RESPONSIVE_400}          }
        </style>`
}

/**
 * What the footer links to.
 *
 * Every default is an absolute NBT URL, so this composer needs no `baseUrl`.
 * Only the unsubscribe link points back at this app, and it stays as the
 * `{{unsubscribe_url}}` token `src/lib/pipeline/deliver.ts` already
 * substitutes per recipient — exactly what the row it replaces carried.
 */
const FOOTER_LINKS = {
  ...DEFAULT_FOOTER_LINKS,
  unsubscribe: EMAIL_TOKENS.UNSUBSCRIBE_URL,
}

/** `.section-label` / `.heading-wrapper h4` — red, 18px, 800. */
function sectionHeading(text: string): string {
  return `
          <tr>
            <td class="nl-gutter nl-section-label" style="padding: 6px ${BODY_GUTTER}px 8px; font-family: ${FONT_STACK}; font-size: 18px; font-weight: 800; color: ${RED};">
              ${esc(text)}
            </td>
          </tr>`
}

export function composeNewsletter({ items, featuredPodcast, date }: ComposeParams): string {
  const issueDate = date || formatNewsletterDate()

  const articleBlocks = items
    .map(
      (item) => `
          <tr>
            <td class="nl-gutter" style="padding: 18px ${BODY_GUTTER}px; border-bottom: 1px solid ${LIGHT_GRAY};">
              <a href="${esc(item.url)}" style="text-decoration: none; color: ${BLACK};">
                <h2 class="nl-card-title" style="font-family: ${FONT_STACK}; font-size: 17px; line-height: 1.4; font-weight: 800; margin: 0 0 8px; color: ${BLACK}; ${BREAK_WORD}">${esc(item.title)}</h2>
              </a>
              <p style="font-family: ${FONT_STACK}; font-size: 14px; color: #444444; margin: 0 0 10px; line-height: 1.55; ${BREAK_WORD}">
                ${esc(item.summary)}
              </p>
              <a href="${esc(withArticleUtm(item.url))}" style="font-family: ${FONT_STACK}; font-size: 13px; font-weight: 700; color: ${RED}; text-decoration: none;">
                पूरी खबर पढ़ें &rarr;
              </a>
              ${item.source ? `<p style="font-family: ${FONT_STACK}; font-size: 11px; color: #999999; margin: 6px 0 0;">${esc(item.source)}</p>` : ''}
            </td>
          </tr>`
    )
    .join('')

  // `.top-podcast` sits above the card list on the page, behind its own red
  // label; the soft-red panel is the `.daily-summary` treatment reused.
  const podcastBlock = featuredPodcast
    ? `
          ${sectionHeading(DEFAULT_LABELS.podcastLabel)}
          <tr>
            <td class="nl-gutter" style="padding: 0 ${BODY_GUTTER}px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate; border: 2px solid ${RED}; border-radius: 4px; background-color: ${SOFT_RED};">
                <tr>
                  <td class="nl-panel" style="padding: 16px 20px 14px;">
                    <h2 class="nl-card-title" style="font-family: ${FONT_STACK}; font-size: 17px; line-height: 1.4; font-weight: 800; margin: 0 0 8px; color: ${BLACK}; ${BREAK_WORD}">${esc(featuredPodcast.title)}</h2>
                    <p style="font-family: ${FONT_STACK}; font-size: 14px; color: #444444; margin: 0 0 10px; line-height: 1.55; ${BREAK_WORD}">${esc(featuredPodcast.summary)}</p>
                    <a href="${esc(withCampaignUtm(featuredPodcast.url))}" style="font-family: ${FONT_STACK}; font-size: 13px; font-weight: 700; color: ${RED}; text-decoration: none;">
                      अभी सुनें &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : ''

  return `
    <html lang="hi">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="x-apple-disable-message-reformatting" />${responsiveStyles()}
      </head>
      <body style="margin: 0; padding: 0; background-color: ${CREAM}; font-family: ${FONT_STACK}; color: ${BLACK};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; background-color: ${CREAM};">
          <tr>
            <td class="nl-page" align="center" style="padding: 30px 15px;">
              <table class="nl-shell" width="${SHELL_WIDTH}" align="center" cellpadding="0" cellspacing="0" border="0" style="width: ${SHELL_WIDTH}px; max-width: ${SHELL_WIDTH}px; border-collapse: collapse; background-color: ${WHITE}; border: 1px solid ${SHELL_BORDER};">

                <!-- .masthead -->
                <tr>
                  <td class="nl-gutter" align="center" style="padding: 25px ${HEADER_GUTTER}px 18px;">
                    <a href="${esc(withCampaignUtm(DEFAULT_FOOTER_LINKS.home))}" target="_blank">
                      <img src="${LOGO_URL}" width="130" alt="NBT" style="display: block; width: 130px; max-width: 130px; height: auto; border: 0; outline: none; text-decoration: none;" />
                    </a>
                  </td>
                </tr>

                <!-- .newsletter-date.header-date -->
                <tr>
                  <td class="nl-gutter" align="right" style="padding: 0 ${HEADER_GUTTER}px 10px; font-family: ${FONT_STACK}; font-size: 14px; font-weight: 600; color: ${GRAY};">
                    ${esc(issueDate)}
                  </td>
                </tr>

                <!-- .red-line -->
                <tr>
                  <td class="nl-gutter" style="padding: 0 ${HEADER_GUTTER}px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                      <tr>
                        <td height="3" bgcolor="${RED}" style="height: 0; line-height: 0; font-size: 0; mso-line-height-rule: exactly; border-top: 3px solid ${RED};">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- .reader-greeting -->
                <tr>
                  <td class="nl-gutter" style="padding: 18px ${HEADER_GUTTER}px 12px; font-family: ${FONT_STACK}; font-size: 18px; font-weight: 800; color: ${RED};">
                    ${esc(DEFAULT_LABELS.greeting)}
                  </td>
                </tr>
                ${podcastBlock}
                ${sectionHeading(DEFAULT_LABELS.selectedNewsHeading)}
                ${articleBlocks}
                ${renderFooter('', FOOTER_LINKS, DEFAULT_LABELS)}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}
