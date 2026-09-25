/**
 * TEMPORARY — reads the real newsletter issue out of the running app.
 *
 * Read-only, and over HTTP only: nothing here imports `src/lib/delivery/*` or
 * `src/lib/email/*`, so no production module is modified, replaced or linked
 * against. `/api/newsletter/issue/send` is never called, so Resend is not
 * invoked and the issue is never marked `sending`/`sent`.
 *
 *     GET  /api/newsletter/issue/preview?format=json    is an issue stored?
 *     POST /api/newsletter/issue/generate               build it if not
 *     GET  /api/newsletter/issue/preview?email=<to>     the stored HTML
 */

import { appBaseUrl, cronHeaders } from './env.mjs';

/**
 * @typedef {object} IssueMeta
 * @property {string} id
 * @property {string} date
 * @property {string} status
 * @property {string} subject
 * @property {number} [htmlBytes]
 */

/**
 * Readable failures: the routes answer with a JSON error shape worth showing.
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function failureDetail(response) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return `${parsed.code ?? response.status}: ${parsed.error}`;
  } catch {
    // not JSON — fall through to the raw body
  }
  return `HTTP ${response.status} ${body.slice(0, 300)}`;
}

/**
 * @param {Record<string, string>} params
 * @param {string | undefined} date
 * @returns {string}
 */
function previewUrl(params, date) {
  const url = new URL('/api/newsletter/issue/preview', appBaseUrl());
  if (date) url.searchParams.set('date', date);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** @returns {Promise<boolean>} */
export async function appIsReachable() {
  return fetch(appBaseUrl(), { method: 'HEAD' }).then(
    () => true,
    () => false
  );
}

/**
 * The stored issue's metadata, or null when nothing is stored for that date.
 * @param {string} [date]
 * @returns {Promise<IssueMeta | null>}
 */
export async function readIssueMeta(date) {
  const response = await fetch(previewUrl({ format: 'json' }, date), { headers: cronHeaders() });

  if (response.ok) {
    const body = await response.json();
    return body.issue;
  }

  const body = await response.clone().text();
  if (response.status === 404 || body.includes('ISSUE_NOT_FOUND')) return null;
  throw new Error(`Could not read the stored issue — ${await failureDetail(response)}`);
}

/**
 * Builds today's issue through the existing generate route. Sends nothing.
 * @param {boolean} [force]
 * @returns {Promise<{ issue: IssueMeta, reused: boolean }>}
 */
export async function generateIssue(force) {
  const url = new URL('/api/newsletter/issue/generate', appBaseUrl());
  if (force) url.searchParams.set('force', '1');

  const response = await fetch(url, { method: 'POST', headers: cronHeaders() });
  if (!response.ok) {
    throw new Error(`Issue generation failed — ${await failureDetail(response)}`);
  }

  const body = await response.json();
  return { issue: body.issue, reused: Boolean(body.reused) };
}

/**
 * The stored HTML with `{{tokens}}` resolved for this reader — the same
 * substitution the real sender performs, done by the preview route itself.
 * @param {string} email
 * @param {string} [date]
 * @returns {Promise<string>}
 */
export async function readIssueHtml(email, date) {
  const response = await fetch(previewUrl({ email }, date), { headers: cronHeaders() });
  if (!response.ok) {
    throw new Error(`Could not read the issue HTML — ${await failureDetail(response)}`);
  }
  return response.text();
}

/**
 * Everything needed to mail one issue: metadata, subject and personalised HTML.
 * Reuses the stored snapshot; generates only when there is none (or on force).
 *
 * @param {{ to: string, force?: boolean, date?: string }} options
 * @returns {Promise<{ issue: IssueMeta, subject: string, html: string, generated: boolean }>}
 */
export async function resolveNewsletter({ to, force, date }) {
  if (!(await appIsReachable())) {
    throw new Error(`${appBaseUrl()} is not responding — start the app first (npm run dev).`);
  }

  let issue = force ? null : await readIssueMeta(date);
  let generated = false;

  if (!issue) {
    const built = await generateIssue(force);
    issue = built.issue;
    generated = !built.reused;
  }

  const html = await readIssueHtml(to, date);
  // const subject = issue.subject?.trim() || `NBT Newsletter — ${issue.date}`;
  const subject = `Morning Newsletter : ${issue.subject?.trim() || `NBT Newsletter — ${issue.date}`}`;

  return { issue, subject, html, generated };
}
