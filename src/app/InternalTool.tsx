/* eslint-disable @next/next/no-img-element */
// Internal-team screen: three actions — generate the newsletter's HTML,
// show the URL card, then take the file.
//
//   Generate HTML  ->  POST /api/InternalTool
//                        -> generateIssue()            existing pipeline
//                        -> nbtNewsletter.html filled  existing template
//                        -> stored on the issue        newsletter_issues
//                      <- the populated document
//
//   Generate URL   ->  GET /api/InternalTool?format=url
//                      <- the link to /api/InternalTool?view=1&id=…, which
//                         serves the snapshot Generate HTML stored
//
//   Download HTML  ->  the document this session just generated, or, if there
//                      is none yet, GET /api/InternalTool?download=1 for the
//                      stored snapshot. Either way it is the populated file,
//                      never the template with its tokens still in it.
//
// The markup below is unchanged — plain Tailwind, NBT palette as literal hex,
// the two button icons inline so the file carries no icon-library import. The
// logo is served from the remote CDN (static.langimg.com) and next.config.ts
// declares no `images.remotePatterns`, so this follows src/app/page.tsx and
// uses a plain <img>.

"use client";

import { useCallback, useState } from "react";

const NBT_LOGO =
  "https://static.langimg.com/thumb/119164302/navbharat-times.jpg?width=366&resizemode=4";

const DOWNLOAD_NAME = "nbtNewsletter.html";

/** The route answers `{ ok: false, code, error }` on every failure path. */
async function failureFrom(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (payload?.error) return String(payload.error);
  } catch {
    // A non-JSON body — fall through to the status line.
  }
  return `Request failed (${response.status})`;
}

export default function InternalTool() {
  const [html, setHtml] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"generate" | "url" | "download" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setBusy("generate");
    setError(null);
    try {
      const response = await fetch("/api/InternalTool", { method: "POST" });
      if (!response.ok) throw new Error(await failureFrom(response));

      const payload = await response.json();
      if (!payload?.html) throw new Error("The issue carries no HTML snapshot");
      setHtml(payload.html as string);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, []);

  const generateUrl = useCallback(async () => {
    setBusy("url");
    setError(null);
    try {
      const response = await fetch("/api/InternalTool?format=url");
      if (!response.ok) throw new Error(await failureFrom(response));

      const payload = await response.json();
      if (!payload?.url) throw new Error("The server returned no URL");
      setPageUrl(payload.url as string);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, []);

  const download = useCallback(async () => {
    setBusy("download");
    setError(null);
    try {
      // What this session generated is the same document the route stored; a
      // reload with nothing in hand falls back to reading that snapshot.
      let markup = html;
      if (!markup) {
        const response = await fetch("/api/InternalTool?download=1");
        if (!response.ok) throw new Error(await failureFrom(response));
        markup = await response.text();
        setHtml(markup);
      }

      const url = URL.createObjectURL(
        new Blob([markup], { type: "text/html;charset=utf-8" }),
      );
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = DOWNLOAD_NAME;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [html]);

  return (
    <div className="min-h-screen bg-[#f6f7f9] font-sans">
      {/* ---------- Header ---------- */}
      <header className="bg-white">
        <div className="flex items-center justify-center px-6 py-10">
          <img src={NBT_LOGO} alt="Navbharat Times" className="h-11 w-auto" />
        </div>
        <div className="h-[2px] w-full bg-[#d91f26]" />
      </header>

      {/* ---------- Body ---------- */}
      <main className="flex justify-center px-4 py-14 sm:py-5">
        <div className="w-full max-w-lg rounded-xl border border-[#e8eaee] bg-white p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(16,24,40,0.16)] sm:p-12">
          {/* Section 1 — Generate HTML */}
          <section>
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-[#111317]">
              Generate HTML
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">
              Generate the complete HTML code for this newsletter.
            </p>
            <button
              type="button"
              onClick={generate}
              disabled={busy !== null}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-[#d91f26] bg-white px-4 py-3 text-sm font-semibold text-[#d91f26] transition-colors hover:bg-[#fff2f0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d91f26] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              {busy === "generate" ? "Generating…" : "Generate HTML"}
            </button>
          </section>

          {/* ---------- Section divider ---------- */}
          <div className="my-8 h-px w-full bg-[#eceef2]" />

          {/* Section 2 — Generate URL */}
          <section>
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-[#111317]">
              Generate Newsletter URL
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">
              Create a shareable URL for the completed newsletter.
            </p>
            <button
              type="button"
              onClick={generateUrl}
              disabled={busy !== null}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-[#d91f26] bg-white px-4 py-3 text-sm font-semibold text-[#d91f26] transition-colors hover:bg-[#fff2f0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d91f26] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {busy === "url" ? "Generating…" : "Generate URL"}
            </button>
            <div
              aria-live="polite"
              className="mt-4 rounded-lg border border-[#e8eaee] bg-[#f6f7f9] px-4 py-3 text-sm leading-relaxed text-[#6b7280]"
            >
              {pageUrl ? (
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-[#d91f26] underline"
                >
                  {pageUrl}
                </a>
              ) : (
                "Your deployed HTML page URL will appear here."
              )}
            </div>
          </section>

          <div className="my-8 h-px w-full bg-[#eceef2]" />

          {/* Section 3 — Download HTML */}
          <section>
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-[#111317]">
              Download HTML
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">
              Get the full HTML file to use or share.
            </p>
            <button
              type="button"
              onClick={download}
              disabled={busy !== null}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#d91f26] px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#c81920] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d91f26] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {busy === "download" ? "Downloading…" : "Download HTML"}
            </button>
          </section>

          {/* Only rendered when something failed — the idle screen is unchanged. */}
          {error ? (
            <p
              role="alert"
              className="mt-6 text-sm leading-relaxed text-[#d91f26]"
            >
              {error}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
