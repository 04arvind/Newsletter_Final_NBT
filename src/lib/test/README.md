# Temporary email tests

Throwaway scripts that put mail in a real inbox while the production domain and
Resend API key are missing. They substitute **only the transport** — Gmail SMTP
instead of Resend — and change nothing else.

| File                       | What it does                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| `send-test-email.mts`      | Sends one hard-coded test email. No app, no server, no database. |
| `send-newsletter-test.mts` | Sends the **real** newsletter issue. Needs the app running.      |
| `smtp.mjs`                 | Minimal Gmail SMTP transport shared by both.                     |
| `env.mjs`                  | Reads `.env` (read only) for both.                               |

Both send from `NEWSLETTER_FROM_EMAIL` to the first address in `NEWSLETTER_TO`,
authenticating with `NEWSLETTER_FROM_APP_PASSWORD`.

## 1. Plain deliverability check

```bash
node --experimental-strip-types --no-warnings src/lib/test/send-test-email.mts
```

## 2. Send the real newsletter

Needs `npm run dev` running and `MONGODB_URI` reachable — the issue snapshot
lives in the database, not in this folder.

```bash
npm run dev          # in another terminal
node --experimental-strip-types --no-warnings src/lib/test/send-newsletter-test.mts
```

It reuses today's stored issue, generating one only if none exists:

```
GET  /api/newsletter/issue/preview?format=json    is an issue stored?
POST /api/newsletter/issue/generate               build it if not
GET  /api/newsletter/issue/preview?email=<to>     the stored HTML, tokens resolved
     -> Gmail SMTP                                the only substitution
```

Flags: `--debug` (print the SMTP dialogue), `--force` (rebuild today's issue),
`--dry-run` (fetch and report, send nothing), `--date=YYYY-MM-DD`.

## What these do not touch

- **`/api/newsletter/issue/send` is never called.** Resend is not invoked, and
  the issue is never marked `sending`/`sent`. The real pipeline can still send
  the same issue properly once credentials exist.
- **No production module is imported.** Everything arrives over HTTP, so
  `src/lib/delivery/*`, `src/lib/email/*`, the pipeline and the routes are not
  modified, replaced or even linked against. The SMTP code here is a test
  transport, not a `DeliveryProvider` — production still goes through
  `src/lib/delivery/provider.ts`.
- **The recipient ledger and `subscribers` are untouched.** One address, from
  `NEWSLETTER_TO`.
- **`.env` is read, never written.**
- Nothing was installed. Uses `dotenv` (already a dependency) and Node's
  built-in `tls`.

## Deleting it

```bash
rm -rf src/lib/test
```

That is the whole cleanup. Nothing outside this folder refers to it, and no
config, dependency or env file was changed for it.

## Notes

- `NEWSLETTER_FROM_APP_PASSWORD` must be a Google **App Password** (2-Step
  Verification required); a normal password is refused with
  `535-5.7.8 Username and Password not accepted`.
- The subject line is RFC 2047 encoded and the body base64 encoded, so Hindi
  subjects and content survive intact.
- `.mjs` for the shared modules, `.mts` for the entry points: Node's
  type-stripping mode will not resolve an import from one `.mts` file to
  another, and fixing that would mean editing `tsconfig.json` — which these
  tests should not do.
