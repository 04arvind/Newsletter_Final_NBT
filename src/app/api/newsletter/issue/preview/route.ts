/**
 * Read back a stored issue — the snapshot itself, not a fresh render.
 *
 *   GET /api/newsletter/issue/preview                      today's HTML
 *   GET /api/newsletter/issue/preview?date=2026-09-17      that day's HTML
 *   GET /api/newsletter/issue/preview?id=newsletter_2026_09_17
 *   GET /api/newsletter/issue/preview?format=json          metadata only
 *   GET /api/newsletter/issue/preview?email=a@b.com        as that reader sees it
 *
 * Without `email` the `{{tokens}}` are left in place, which is exactly what is
 * stored; with it, the same substitution the sender performs is applied, so a
 * poll or unsubscribe link can be clicked from the preview.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { DeliveryError, findIssueFor } from '../../../../../lib/delivery';
import { assertDeliveryAuthorized, deliveryErrorPayload } from '../../../../../lib/delivery/http';
import { personalizeIssueHtml } from '../../../../../lib/email/personalize';
import { getInternalAppBaseUrl } from '../../../../../lib/internal-base-url';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    assertDeliveryAuthorized(request);

    const params = request.nextUrl.searchParams;
    const issue = await findIssueFor({
      issueId: params.get('id') || undefined,
      date: params.get('date') || undefined,
    });

    if (!issue) {
      throw new DeliveryError(
        'ISSUE_NOT_FOUND',
        'No issue stored for that date — generate one first',
        { id: params.get('id'), date: params.get('date') }
      );
    }

    if (params.get('format') === 'json') {
      return NextResponse.json({
        ok: true,
        issue: {
          id: issue._id,
          date: issue.date,
          status: issue.status,
          subject: issue.subject,
          contentHash: issue.contentHash,
          sealedAt: issue.sealedAt,
          generatedAt: issue.generatedAt,
          sentAt: issue.sentAt,
          htmlBytes: issue.htmlContent?.length ?? 0,
          recipientCount: issue.recipientCount,
          sentCount: issue.sentCount,
          failedCount: issue.failedCount,
        },
      });
    }

    if (!issue.htmlContent) {
      throw new DeliveryError(
        'ISSUE_NOT_RENDERED',
        `Issue ${issue._id} carries no HTML snapshot`,
        { issueId: issue._id, status: issue.status }
      );
    }

    const email = params.get('email')?.trim();
    const html = email
      ? personalizeIssueHtml(issue.htmlContent, {
          email,
          baseUrl: getInternalAppBaseUrl(request),
        })
      : issue.htmlContent;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Issue-Id': issue._id,
        'X-Issue-Status': issue.status,
      },
    });
  } catch (error) {
    const { status, body } = deliveryErrorPayload(error);
    if (status >= 500) console.error('issue preview failed', error);
    return NextResponse.json(body, { status });
  }
}
