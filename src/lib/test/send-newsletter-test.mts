/**
 * TEMPORARY — mails the REAL newsletter through the Gmail test transport.
 *
 * Why this exists: the production send path (`POST /api/newsletter/issue/send`
 * -> `src/lib/delivery/*` -> Resend) cannot run without a verified domain and
 * an API key. This script substitutes only the last hop — the transport — so
 * the actual issue can be seen in a real inbox in the meantime.
 *
 *     GET  /api/newsletter/issue/preview?format=json     is an issue stored?
 *     POST /api/newsletter/issue/generate                build it if not
 *     GET  /api/newsletter/issue/preview?email=<to>      the stored HTML
 *            |
 *     Gmail SMTP (./smtp.mjs)                            <- the only substitution
 *
 * What it does NOT do, on purpose:
 *   - It never calls `/api/newsletter/issue/send`, so Resend is not invoked and
 *     the issue is never marked `sending`/`sent`. The real pipeline can still
 *     send this issue properly once credentials exist.
 *   - It never touches the recipient ledger or `subscribers`. One address, from
 *     NEWSLETTER_TO.
 *   - It imports nothing from the app. Everything it uses arrives over HTTP, so
 *     no production module is modified, replaced or even linked against.
 *
 * Requires the app running (`npm run dev`) and MONGODB_URI reachable, because
 * the issue snapshot lives in the database.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings src/lib/test/send-newsletter-test.mts
 *
 * Flags:
 *   --debug       print the SMTP dialogue
 *   --force       rebuild today's issue before sending (refused once sent)
 *   --dry-run     fetch and report, send nothing
 *   --date=YYYY-MM-DD   mail that day's stored issue instead of today's
 */

import process from 'node:process';
import { appBaseUrl, cronHeaders, gmailCredentials, loadEnv } from './env.mjs';
import { GMAIL_HOST, sendMailViaSmtp } from './smtp.mjs';

interface IssueMeta {
  id: string;
  date: string;
  status: string;
  subject: string;
  htmlBytes: number;
}

const flags = {
  debug: process.argv.includes('--debug'),
  force: process.argv.includes('--force'),
  dryRun: process.argv.includes('--dry-run'),
  date: process.argv.find((arg) => arg.startsWith('--date='))?.slice('--date='.length),
};

/** Readable failures: the routes answer with a JSON error shape worth showing. */
async function failureDetail(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: string; code?: string };
    if (parsed.error) return `${parsed.code ?? response.status}: ${parsed.error}`;
  } catch {
    // not JSON — fall through to the raw body
  }
  return `HTTP ${response.status} ${body.slice(0, 300)}`;
}

function previewUrl(base: string, params: Record<string, string>): string {
  const url = new URL('/api/newsletter/issue/preview', base);
  if (flags.date) url.searchParams.set('date', flags.date);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** Returns the stored issue's metadata, or null when nothing is stored yet. */
async function readIssueMeta(base: string): Promise<IssueMeta | null> {
  const response = await fetch(previewUrl(base, { format: 'json' }), { headers: cronHeaders() });

  if (response.ok) {
    const body = (await response.json()) as { issue: IssueMeta };
    return body.issue;
  }

  const body = await response.clone().text();
  if (response.status === 404 || body.includes('ISSUE_NOT_FOUND')) return null;
  throw new Error(`Could not read the stored issue — ${await failureDetail(response)}`);
}

/** Builds today's issue via the existing generate route. Sends nothing. */
async function generateIssue(base: string): Promise<IssueMeta> {
  const url = new URL('/api/newsletter/issue/generate', base);
  if (flags.force) url.searchParams.set('force', '1');

  console.log(`Generating issue: POST ${url.pathname}${url.search}`);
  const response = await fetch(url, { method: 'POST', headers: cronHeaders() });
  if (!response.ok) {
    throw new Error(`Issue generation failed — ${await failureDetail(response)}`);
  }

  const body = (await response.json()) as { issue: IssueMeta; reused: boolean };
  console.log(`  ${body.reused ? 'reused stored issue' : 'built a fresh issue'}: ${body.issue.id}`);
  return body.issue;
}

/**
 * The stored HTML with `{{tokens}}` resolved for this reader — the same
 * substitution the real sender performs, done by the preview route itself.
 */
async function readIssueHtml(base: string, email: string): Promise<string> {
  const response = await fetch(previewUrl(base, { email }), { headers: cronHeaders() });
  if (!response.ok) {
    throw new Error(`Could not read the issue HTML — ${await failureDetail(response)}`);
  }
  return response.text();
}

async function main(): Promise<void> {
  loadEnv();
  const { from, to, pass } = gmailCredentials();
  const base = appBaseUrl();

  console.log(`App: ${base}`);
  const reachable = await fetch(base, { method: 'HEAD' }).then(
    () => true,
    () => false
  );
  if (!reachable) {
    throw new Error(`${base} is not responding — start the app first (npm run dev).`);
  }

  let issue = flags.force ? null : await readIssueMeta(base);
  if (!issue) {
    console.log(flags.force ? 'Forcing a rebuild.' : 'No issue stored for that date yet.');
    issue = await generateIssue(base);
  } else {
    console.log(`Found stored issue: ${issue.id} (status: ${issue.status})`);
  }

  const html = await readIssueHtml(base, to);
  // const subject = issue.subject?.trim() || `NBT Newsletter — ${issue.date}`;
  const subject = `Morning Newsletter : ${issue.subject?.trim() || `NBT Newsletter — ${issue.date}`}`;

  console.log(`Issue:   ${issue.id}  (${issue.date}, status ${issue.status})`);
  console.log(`Subject: ${subject}`);
  console.log(`HTML:    ${html.length.toLocaleString()} bytes`);

  if (flags.dryRun) {
    console.log('Dry run — nothing sent.');
    return;
  }

  console.log(`Sending newsletter: ${from} -> ${to}`);
  const { response } = await sendMailViaSmtp(
    { user: from, pass, debug: flags.debug },
    { from, to, subject, html }
  );

  console.log(`Accepted by ${GMAIL_HOST}: ${response}`);
  console.log(`Issue ${issue.id} is still "${issue.status}" — the real pipeline has not sent it.`);
}

main().catch((error: unknown) => {
  console.error(`Newsletter test send failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
