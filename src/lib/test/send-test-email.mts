/**
 * TEMPORARY — plain deliverability check: one hard-coded email from
 * NEWSLETTER_FROM_EMAIL to NEWSLETTER_TO through Gmail SMTP.
 *
 * Proves the two mailboxes can exchange mail while the production domain and
 * Resend API key are missing. No app code involved, no server needed — see
 * ./send-newsletter-test.mts to mail the real newsletter instead.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings src/lib/test/send-test-email.mts
 *   node --experimental-strip-types --no-warnings src/lib/test/send-test-email.mts --debug
 */

import process from 'node:process';
import { gmailCredentials, loadEnv } from './env.mjs';
import { GMAIL_HOST, sendMailViaSmtp } from './smtp.mjs';

function testEmailHtml(from: string, to: string, sentAt: Date): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:20px;">SMTP delivery test</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
        If this arrived, the temporary Gmail transport in <code>src/lib/test/</code> works.
        It is unrelated to the newsletter pipeline and to the Resend integration.
      </p>
      <table style="font-size:13px;line-height:1.8;border-collapse:collapse;">
        <tr><td style="padding-right:12px;color:#71717a;">From</td><td>${from}</td></tr>
        <tr><td style="padding-right:12px;color:#71717a;">To</td><td>${to}</td></tr>
        <tr><td style="padding-right:12px;color:#71717a;">Sent</td><td>${sentAt.toISOString()}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#71717a;">
        Temporary test mail — delete <code>src/lib/test/</code> once real credentials land.
      </p>
    </div>
  </body>
</html>`;
}

async function main(): Promise<void> {
  loadEnv();
  const { from, to, pass } = gmailCredentials();
  const sentAt = new Date();

  console.log(`Sending test email: ${from} -> ${to}`);

  const { response } = await sendMailViaSmtp(
    { user: from, pass, debug: process.argv.includes('--debug') },
    {
      from,
      to,
      subject: `Test email from ${from} — ${sentAt.toISOString()}`,
      html: testEmailHtml(from, to, sentAt),
    }
  );

  console.log(`Accepted by ${GMAIL_HOST}: ${response}`);
}

main().catch((error: unknown) => {
  console.error(`Morning email failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
