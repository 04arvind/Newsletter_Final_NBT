/**
 * The two actions behind the internal tool screen (src/app/InternalTool.tsx).
 *
 *   POST /api/InternalTool                 Generate HTML — build + store the issue
 *   POST /api/InternalTool?force=1         rebuild (refused once sending/sent)
 *   POST /api/InternalTool?format=html     the rendered document itself, not JSON
 *
 *   GET  /api/InternalTool                 Download HTML — the stored snapshot, inline
 *   GET  /api/InternalTool?download=1      the same snapshot as a .html attachment
 *   GET  /api/InternalTool?format=json     metadata only, no HTML body
 *
 *   GET  /api/InternalTool?format=url      Generate URL — `{ url }` of the page below
 *   GET  /api/InternalTool?view=1&id=…     that page: the stored nbtNewsletter.html
 *                                          snapshot, served inline to a browser
 *
 * Both accept `?id=` / `?date=` to target a specific issue (the latest generated otherwise)
 * and `?email=` to substitute the `{{tokens}}` the way the sender does, so a
 * downloaded file can have working poll and unsubscribe links.
 *
 * Nothing is rendered here. Generation goes through `generateIssue`, which
 * fetches, renders, validates and seals exactly as the cron path does, and the
 * download reads that stored snapshot back — so the file an editor takes is
 * byte-for-byte the document that would be mailed, not a second render of it.
 *
 * Guarded by the same `x-cron-secret` header as the other delivery routes:
 * generating is an expensive engine + LLM round trip, so it is not left open.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { DeliveryError, findIssueFor, generateIssue } from '../../../lib/delivery';
import { findLatestIssue } from '../../../lib/db/newsletter';
import { assertDeliveryAuthorized, deliveryErrorPayload } from '../../../lib/delivery/http';
import { personalizeIssueHtml } from '../../../lib/email/personalize';
import { getInternalAppBaseUrl } from '../../../lib/internal-base-url';
import type { NewsletterIssueDoc } from '../../../lib/db/types';
import { getNewsletterWindowEndingAt } from '../../../lib/newsletter-window';

export const dynamic = 'force-dynamic';
/** The engine fetch behind a fresh build is the slow part, not the render. */
export const maxDuration = 300;

/** What the tool shows about an issue, minus the HTML itself. */
function issueSummary(issue: NewsletterIssueDoc) {
  return {
    id: issue._id,
    date: issue.date,
    status: issue.status,
    subject: issue.subject,
    contentHash: issue.contentHash,
    sealedAt: issue.sealedAt,
    generatedAt: issue.generatedAt,
    sentAt: issue.sentAt,
    htmlBytes: issue.htmlContent?.length ?? 0,
  };
}

/** The tool downloads the populated template under the template's own name. */
const DOWNLOAD_NAME = 'nbtNewsletter.html';

/**
 * Who may call this route.
 *
 * The delivery routes are guarded by the `x-cron-secret` header, which a
 * browser `fetch` from the tool cannot set. A same-origin request carries an
 * `Origin` matching this app instead, which is the standard CSRF check and is
 * enough here: the page it comes from is already the internal screen. Anything
 * else — curl, Postman, another site — sends no matching origin and still has
 * to present the secret, so `assertDeliveryAuthorized` keeps the last word.
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

function authorize(request: NextRequest): void {
  if (isSameOriginRequest(request)) return;
  assertDeliveryAuthorized(request);
}

/**
 * The snapshot as it should leave the route: stored HTML, with the reader
 * tokens filled in when an address was given.
 */
function resolveHtml(
  issue: NewsletterIssueDoc,
  request: NextRequest
): string {
  if (!issue.htmlContent) {
    throw new DeliveryError(
      'ISSUE_NOT_RENDERED',
      `Issue ${issue._id} carries no HTML snapshot`,
      { issueId: issue._id, status: issue.status }
    );
  }

  const email = request.nextUrl.searchParams.get('email')?.trim();
  return email
    ? personalizeIssueHtml(issue.htmlContent, {
        email,
        baseUrl: getInternalAppBaseUrl(request),
      })
    : issue.htmlContent;
}

function htmlResponse(
  html: string,
  issue: NewsletterIssueDoc,
  { attachment }: { attachment: boolean }
): NextResponse {
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Issue-Id': issue._id,
    'X-Issue-Status': issue.status,
  };

  if (attachment) {
    headers['Content-Disposition'] = `attachment; filename="${DOWNLOAD_NAME}"`;
  }

  return new NextResponse(html, { headers });
}

/* -------------------------------------------------------------------- View */

/**
 * The newsletter page a Generate URL link opens.
 *
 * It serves the snapshot Generate HTML stored — the populated
 * `nbtNewsletter.html`, never the bare template — so the link shows exactly
 * the document that was generated. Both this and `?format=url` are left open:
 * a link pasted into a browser tab carries no `Origin` and no secret, and all
 * either can do is read back a document that is going out to readers anyway.
 * Nothing is generated here, and no reader tokens are substituted.
 */
async function storedIssueFor(request: NextRequest): Promise<NewsletterIssueDoc> {
  const params = request.nextUrl.searchParams;
  const issue = await findToolIssue(request);

  if (!issue) {
    throw new DeliveryError(
      'ISSUE_NOT_FOUND',
      'No issue stored for that date — generate one first',
      { id: params.get('id'), date: params.get('date') }
    );
  }
  if (!issue.htmlContent) {
    throw new DeliveryError(
      'ISSUE_NOT_RENDERED',
      `Issue ${issue._id} carries no HTML snapshot`,
      { issueId: issue._id, status: issue.status }
    );
  }
  return issue;
}

/**
 * The issue a tool action reads: the one named by `?id=`, otherwise the most
 * recently generated version (of `?date=` when given), so Generate URL and
 * Download HTML follow the latest Generate HTML click.
 */
function findToolIssue(request: NextRequest): Promise<NewsletterIssueDoc | null> {
  const params = request.nextUrl.searchParams;
  const issueId = params.get('id');
  return issueId
    ? findIssueFor({ issueId })
    : findLatestIssue(params.get('date') || undefined);
}

/** Where `?view=1` serves an issue, on whichever host this app runs on. */
function issuePageUrl(issue: NewsletterIssueDoc, request: NextRequest): string {
  return `${getInternalAppBaseUrl(request)}/api/InternalTool?view=1&id=${encodeURIComponent(issue._id)}`;
}

async function viewResponse(request: NextRequest): Promise<NextResponse> {
  try {
    const params = request.nextUrl.searchParams;
    const issue = await storedIssueFor(request);

    if (params.get('format') === 'url') {
      return NextResponse.json({
        ok: true,
        url: issuePageUrl(issue, request),
        issue: issueSummary(issue),
      });
    }

    return htmlResponse(issue.htmlContent as string, issue, { attachment: false });
  } catch (error) {
    const { status, body } = deliveryErrorPayload(error);
    if (status >= 500) console.error('InternalTool view failed', error);
    return NextResponse.json(body, { status });
  }
}

/* ---------------------------------------------------------------- Generate */

export async function POST(request: NextRequest) {
  try {
    authorize(request);

    const params = request.nextUrl.searchParams;
    const { issue, reused, contentHash } = await generateIssue({
      baseUrl: getInternalAppBaseUrl(request),
      force: params.get('force') === '1',
      // The window ends at this click, not at a fixed 06:00 boundary.
      window: getNewsletterWindowEndingAt(new Date()),
      // Every click stores its own version; a same-day issue is never reused.
      newVersion: true,
    });

    // `?format=html` hands back the document itself — handy for piping the
    // result of a generate straight into a file.
    if (params.get('format') === 'html') {
      return htmlResponse(resolveHtml(issue, request), issue, { attachment: false });
    }

    return NextResponse.json({
      ok: true,
      // True when a stored snapshot was returned rather than a fresh render,
      // which is why pressing Generate twice cannot change a ready issue.
      reused,
      issue: { ...issueSummary(issue), contentHash },
      html: resolveHtml(issue, request),
      download: `/api/InternalTool?id=${encodeURIComponent(issue._id)}&download=1`,
    });
  } catch (error) {
    const { status, body } = deliveryErrorPayload(error);
    if (status >= 500) console.error('InternalTool generate failed', error);
    return NextResponse.json(body, { status });
  }
}

/* ---------------------------------------------------------------- Download */

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams;
  if (mode.get('view') === '1' || mode.get('format') === 'url') {
    return viewResponse(request);
  }

  try {
    authorize(request);

    const params = request.nextUrl.searchParams;
    const issue = await findToolIssue(request);

    if (!issue) {
      throw new DeliveryError(
        'ISSUE_NOT_FOUND',
        'No issue stored for that date — generate one first',
        { id: params.get('id'), date: params.get('date') }
      );
    }

    if (params.get('format') === 'json') {
      return NextResponse.json({ ok: true, issue: issueSummary(issue) });
    }

    return htmlResponse(resolveHtml(issue, request), issue, {
      attachment: params.get('download') === '1',
    });
  } catch (error) {
    const { status, body } = deliveryErrorPayload(error);
    if (status >= 500) console.error('InternalTool download failed', error);
    return NextResponse.json(body, { status });
  }
}
