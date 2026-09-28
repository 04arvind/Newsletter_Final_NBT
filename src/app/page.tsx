// // /* eslint-disable @next/next/no-img-element */
// // // Article and podcast artwork comes from arbitrary remote hosts (NBT CDN,
// // // i.ytimg.com), and globals.css styles these nodes through raw `img`
// // // selectors (.news-card img, .hero-image, .top-podcast-thumb), so next/image's
// // // wrapper markup and remotePatterns allowlist would fight the design.

// // "use client";

// // import { useCallback, useEffect, useRef, useState } from "react";
// // import { BsStars } from "react-icons/bs";
// // import { FaPodcast } from "react-icons/fa";

// // import Footer from "../app/Footer";
// // // The recap bullets, the date line and the stock card artwork are shared with
// // // the email edition (src/lib/email/newsletter-data.ts), so both editions of the
// // // same issue read identically.
// // import {
// //   cardImageFor,
// //   formatNewsletterDate,
// //   toSummaryLine,
// // } from "../lib/newsletter-presentation";

// // /* =========================================
// //    API SHAPES  (GET /api/trends/merge → .newsletter)
// // ========================================= */

// // interface NewsletterArticle {
// //   url: string;
// //   title: string;
// //   description?: string;
// //   image?: string;
// //   author?: string;
// //   newsletterSummary?: string;
// // }

// // interface NewsletterPodcast {
// //   id?: string;
// //   videoId?: string;
// //   title: string;
// //   url: string;
// //   thumbnail?: string;
// //   duration?: string;
// //   finalScore?: number;
// // }

// // interface NewsletterHook {
// //   type: "poll";
// //   question: string;
// //   options: string[];
// // }

// // /*
// //  * Live poll: the question and options are mirrored from NBT, but every number
// //  * below is ours — NBT's own vote split is never fetched or shown.
// //  */
// // interface LivePollOption {
// //   label: string;
// //   value: number;
// //   /** Votes cast by newsletter readers. */
// //   votes: number;
// //   /** Our readers' share (whole numbers summing to 100). */
// //   percent: number;
// // }

// // interface LivePoll {
// //   pollId: string;
// //   sectionId: string;
// //   question: string;
// //   options: LivePollOption[];
// //   fetchedAt: string;
// // }

// // interface PollResponse {
// //   poll?: LivePoll;
// //   totalVotes?: number;
// //   yourVote?: number | null;
// //   votingEnabled?: boolean;
// //   /** True when NBT was unreachable and this is the last poll we stored. */
// //   stale?: boolean;
// // }

// // interface NewsletterPayload {
// //   topStory?: NewsletterArticle | null;
// //   podcast?: NewsletterPodcast | null;
// //   selectedNews?: NewsletterArticle[];
// //   past24Hours?: NewsletterArticle[];
// //   hook?: NewsletterHook | null;
// // }

// // const ENGINE_URL = "/api/trends/merge";
// // const ANALYTICS_URL = "/api/analytics/podcast";
// // const POLL_URL = "/api/poll";
// // const MORE_NEWS_URL = "https://navbharattimes.indiatimes.com/";

// // /**
// //  * NBT's poll answers are almost always a yes / no / can't-say triad, so keep
// //  * the template's coloured icons keyed off the wording rather than the index.
// //  */
// // function pollIconFor(label: string, index: number): { icon: string; glyph: string } {
// //   const text = label.trim();

// //   if (/कह सकते|पता नहीं|कुछ कह|शायद|maybe|can'?t say/i.test(text)) {
// //     return { icon: "maybe", glyph: "fa-question" };
// //   }
// //   if (/^(हां|हाँ|yes)/i.test(text)) return { icon: "yes", glyph: "fa-check" };
// //   if (/^(नहीं|ना|no)/i.test(text)) return { icon: "no", glyph: "fa-xmark" };

// //   return [
// //     { icon: "yes", glyph: "fa-check" },
// //     { icon: "no", glyph: "fa-xmark" },
// //     { icon: "maybe", glyph: "fa-question" },
// //   ][index % 3];
// // }

// // /* =========================================
// //    PAGE
// // ========================================= */

// // export default function Home() {
// //   const [newsletter, setNewsletter] = useState<NewsletterPayload | null>(null);
// //   const [fetchedAt, setFetchedAt] = useState<string | undefined>(undefined);
// //   const [selectedPoll, setSelectedPoll] = useState<number | null>(null);
// //   const [livePoll, setLivePoll] = useState<LivePoll | null>(null);
// //   const [pollTotalVotes, setPollTotalVotes] = useState(0);
// //   const [pollVotingEnabled, setPollVotingEnabled] = useState(false);
// //   const [pollPending, setPollPending] = useState(false);
// //   const impressionSent = useRef(false);

// //   /* Load the trending engine payload, retrying like script.js did. */
// //   useEffect(() => {
// //     let cancelled = false;
// //     let timer: ReturnType<typeof setTimeout> | undefined;

// //     const load = (attempt = 0) => {
// //       fetch(ENGINE_URL, { headers: { Accept: "application/json" } })
// //         .then((response) => {
// //           if (!response.ok) {
// //             throw new Error(`Trending engine returned ${response.status}`);
// //           }
// //           return response.json();
// //         })
// //         .then((data) => {
// //           if (cancelled) return;
// //           setNewsletter(data.newsletter ?? null);
// //           setFetchedAt(data.fetchedAt);
// //         })
// //         .catch(() => {
// //           if (cancelled || attempt >= 10) return;
// //           timer = setTimeout(() => load(attempt + 1), 2000);
// //         });
// //     };

// //     load();
// //     return () => {
// //       cancelled = true;
// //       if (timer) clearTimeout(timer);
// //     };
// //   }, []);

// //   /* Today's NBT poll, plus however our own readers have voted on it so far. */
// //   useEffect(() => {
// //     let cancelled = false;

// //     fetch(POLL_URL, {
// //       headers: { Accept: "application/json" },
// //       // The voter cookie the API mints is what restores an earlier answer.
// //       credentials: "same-origin",
// //     })
// //       .then((response) => {
// //         if (!response.ok) throw new Error(`Poll API returned ${response.status}`);
// //         return response.json();
// //       })
// //       .then((data: PollResponse) => {
// //         if (cancelled || !data.poll?.options?.length) return;
// //         setLivePoll(data.poll);
// //         setPollTotalVotes(data.totalVotes ?? 0);
// //         setPollVotingEnabled(Boolean(data.votingEnabled));
// //         if (typeof data.yourVote === "number") setSelectedPoll(data.yourVote);
// //       })
// //       .catch(() => {
// //         // Falls back to the engine-generated hook below.
// //       });

// //     return () => {
// //       cancelled = true;
// //     };
// //   }, []);

// //   const trackPodcastEvent = useCallback(
// //     (eventName: string, podcast: NewsletterPodcast) => {
// //       if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
// //       const payload = JSON.stringify({
// //         event: eventName,
// //         podcastId: podcast.id,
// //         podcastTitle: podcast.title,
// //         podcastScore: podcast.finalScore,
// //         newsletterDate: new Date().toISOString().slice(0, 10),
// //       });
// //       navigator.sendBeacon(
// //         ANALYTICS_URL,
// //         new Blob([payload], { type: "application/json" })
// //       );
// //     },
// //     []
// //   );

// //   const topStory = newsletter?.topStory ?? null;
// //   const podcast = newsletter?.podcast ?? null;
// //   const selectedNews = newsletter?.selectedNews ?? [];
// //   const past24Hours = newsletter?.past24Hours ?? [];
// //   const hook = newsletter?.hook ?? null;

// //   useEffect(() => {
// //     if (!podcast || impressionSent.current) return;
// //     impressionSent.current = true;
// //     trackPodcastEvent("podcast_impression", podcast);
// //   }, [podcast, trackPodcastEvent]);

// //   // NEWSLETTER_RECAP_SIZE is 6, so a 7th bullet here would always miss its
// //   // generated summary and fall through to the local rewriting path.
// //   const summaryArticles = [topStory, ...selectedNews.slice(0, 5)].filter(
// //     (article): article is NewsletterArticle => Boolean(article)
// //   );

// //   // The template's button called openFeedback(), which script.js never defined.
// //   // TODO: point this at the feedback flow once it exists.
// //   const openFeedback = () => {};

// //   /* Prefer today's live NBT poll; fall back to the engine-generated hook. */
// //   const pollQuestion = livePoll?.question || hook?.question || "";
// //   const pollOptions: LivePollOption[] = livePoll
// //     ? livePoll.options
// //     : (hook?.options || []).map((label, index) => ({
// //         label,
// //         value: index + 1,
// //         votes: 0,
// //         percent: 0,
// //       }));
// //   // Our own tally only means anything once it has been written and read back.
// //   const pollResultsReady =
// //     selectedPoll !== null && pollVotingEnabled && pollTotalVotes > 0;

// //   const castPollVote = (index: number) => {
// //     if (pollPending) return;

// //     const previous = selectedPoll;
// //     if (previous === index) return;

// //     setSelectedPoll(index);

// //     if (!livePoll || !pollVotingEnabled) return;

// //     setPollPending(true);
// //     fetch(POLL_URL, {
// //       method: "POST",
// //       headers: { "Content-Type": "application/json", Accept: "application/json" },
// //       credentials: "same-origin",
// //       body: JSON.stringify({ pollId: livePoll.pollId, option: index }),
// //     })
// //       .then((response) => {
// //         if (!response.ok) throw new Error(`Vote failed (${response.status})`);
// //         return response.json();
// //       })
// //       .then((data: PollResponse) => {
// //         // The response carries the recounted split, so no second round trip.
// //         if (data.poll?.options?.length) setLivePoll(data.poll);
// //         setPollTotalVotes(data.totalVotes ?? 0);
// //         if (typeof data.yourVote === "number") setSelectedPoll(data.yourVote);
// //       })
// //       .catch(() => {
// //         // Roll the highlight back so we never imply a vote that wasn't stored.
// //         setSelectedPoll(previous);
// //       })
// //       .finally(() => setPollPending(false));
// //   };

// //   const renderNewsCard = (article: NewsletterArticle, index: number) => (
// //     <article className="news-card" key={article.url || index}>
// //       <img
// //         src={cardImageFor(article.image, index)}
// //         alt={article.title || "NBT समाचार"}
// //       />

// //       <div className="news-content">
// //         <h3>{article.title}</h3>

// //         <p>
// //           {article.description ||
// //             "NBT की ताजा खबर और उससे जुड़ी जरूरी जानकारी पढ़ें।"}
// //         </p>

// //         <a
// //           href={article.url}
// //           className="card-link"
// //           target="_blank"
// //           rel="noopener noreferrer"
// //         >
// //           पूरी खबर पढ़ें →
// //         </a>
// //       </div>
// //     </article>
// //   );

// //   return (
// //     <div className="page">
// //       <div className="newsletter">

// //         {/* =========================================
// //              HEADER
// //         ========================================== */}

// //         <header className="masthead">
// //           <div className="header-logo">
// //     <a href="https://navbharattimes.indiatimes.com/" target="_blank" rel="noopener noreferrer">
// //       <img src="/newsletter-assets/logo.jpeg" alt="NBT" />
// //     </a>
// //     </div>
// //     </header>

// //         <div className="newsletter-date header-date">
// //           <span id="newsletter-date">
// //             {newsletter ? formatNewsletterDate(fetchedAt) : ""}
// //           </span>
// //         </div>

// //         <div className="red-line"></div>

// //         <div className="reader-greeting" aria-label="Greeting">
// //           सुप्रभात
// //         </div>

// //         <section className="daily-summary" aria-labelledby="daily-summary-title">
// //           {/* <h2 id="daily-summary-title">30 सेकंड में आज की तस्वीर</h2> */}
// //           <h2 id="daily-summary-title">
// //             <BsStars aria-hidden="true" />
// //             आज का न्यूज़ रीकैप
// //           </h2>
// //           <ul id="daily-summary-list">
// //             {summaryArticles.map((article, index) => (
// //               <li key={article.url || index}>{toSummaryLine(article)}</li>
// //             ))}
// //           </ul>
// //         </section>

// //         <div className="newsletter-bar">
// //           <div className="top-story-heading">
// //             {/* <div className="section-label">मुख्य समाचार</div> */}

// //             <div className="top-story-line"></div>
// //           </div>
// //         </div>

// //         {/* =========================================
// //              HERO STORY
// //         ========================================== */}

// //         <section className="hero-section">
// //           <div className="hero-image-wrapper">
// //             {/* script.js only set a src when the story actually had an image —
// //                 no stock fallback on the lead story. */}
// //             {topStory?.image ? (
// //               <img
// //                 id="top-story-image"
// //                 src={topStory.image}
// //                 className="hero-image"
// //                 alt={topStory.title}
// //               />
// //             ) : null}
// //           </div>

// //           <div className="hero-text">
// //             <h2 id="top-story-title">{topStory?.title || ""}</h2>

// //             <div className="story-author">
// //               <i className="fa-regular fa-pen-to-square"></i>
// //               <span id="top-story-author">{topStory?.author || ""}</span>
// //             </div>

// //             <p id="top-story-description">{topStory?.description || ""}</p>

// //             <a
// //               id="top-story-link"
// //               href={topStory?.url || "#"}
// //               className="red-link"
// //               target="_blank"
// //               rel="noopener noreferrer"
// //             >
// //               {topStory ? "पूरी खबर पढ़ें →" : ""}
// //             </a>
// //           </div>
// //         </section>

// //         {/* =========================================
// //              TOP PODCAST
// //         ========================================== */}

// //         <section className="top-podcast" aria-label="NBT का टॉप पॉडकास्ट">
// //           <div className="top-podcast-label flex items-center gap-1">
// //             <FaPodcast aria-hidden="true" />
// //             आज का पॉडकास्ट
// //           </div>

// //           <a
// //             id="top-podcast-link"
// //             className="top-podcast-media"
// //             href={podcast?.url || "https://www.youtube.com/@navbharattimes/podcasts"}
// //             target="_blank"
// //             rel="noopener noreferrer"
// //             aria-label={`${podcast?.title || "NBT का टॉप पॉडकास्ट"} YouTube पर सुनें`}
// //             onClick={() => {
// //               if (podcast) trackPodcastEvent("podcast_click", podcast);
// //             }}
// //           >
// //             <img
// //               id="top-podcast-thumb"
// //               className="top-podcast-thumb"
// //               src={podcast?.thumbnail || "/newsletter-assets/trending-news-nbt.jpeg"}
// //               alt={podcast?.title || "NBT का टॉप पॉडकास्ट"}
// //               width={600}
// //               height={338}
// //               onError={(event) => {
// //                 // A missing maxres/sd still falls back to the always-present
// //                 // hqdefault frame.
// //                 if (!podcast?.videoId) return;
// //                 const image = event.currentTarget;
// //                 const fallback = `https://i.ytimg.com/vi/${podcast.videoId}/hqdefault.jpg`;
// //                 if (image.src !== fallback) image.src = fallback;
// //               }}
// //             />

// //             <span className="top-podcast-play" aria-hidden="true">
// //               ▶
// //             </span>

// //             <span id="top-podcast-duration" className="top-podcast-duration">
// //               {podcast?.duration || ""}
// //             </span>
// //           </a>
// //         </section>

// //         {/* =========================================
// //              CURATED NEWS
// //         ========================================== */}

// //         <section className="selected-news" id="todays-selected-news">
// //           <div className="heading-wrapper">
// //            // <h4>आज की प्रमुख खबरें</h4>
// //             <h4>चाय की चुस्की और आज की मुख्य बातें</h4>

// //             {/* <div className="heading-line"></div> */}
// //           </div>

// //           <div className="news-grid" id="selected-news-grid">
// //             {selectedNews.map(renderNewsCard)}
// //           </div>

// //           <div className="more-news">
// //             <a href={MORE_NEWS_URL}>
// //               और खबरें देखें
// //               <span>→</span>
// //             </a>
// //           </div>
// //         </section>

// //         {/* =========================================
// //              PAST 24 HOURS
// //         ========================================== */}

// //         <section className="selected-news" id="past-24-hours-news">
// //           <div className="heading-wrapper">
// //             {/* <h4>पिछले 24 घंटे में</h4> */}
// //             <h4>बीते 24 घंटे: द बिग 3</h4>

// //             {/* <div className="heading-line"></div> */}
// //           </div>

// //           <div className="news-grid" id="past-news-grid">
// //             {past24Hours.map(renderNewsCard)}
// //           </div>
// //         </section>

// //         {/* =========================================
// //              QUICK POLL
// //         ========================================== */}

// //         {/* <div className="hook-box">
// //           <h3 className="hook-question">
// //             <span id="hook-question">{pollQuestion}</span>
// //           </h3>

// //           <div className={`poll-options${pollResultsReady ? " voted" : ""}`}>
// //             {pollOptions.map((option, index) => {
// //               const { icon, glyph } = pollIconFor(option.label, index);

// //               return (
// //                 <button
// //                   key={option.value}
// //                   className={`poll-option${selectedPoll === index ? " selected" : ""}`}
// //                   onClick={() => castPollVote(index)}
// //                   disabled={pollPending}
// //                   aria-pressed={selectedPoll === index}
// //                 >
// //                   {pollResultsReady && (
// //                     <span
// //                       className="poll-bar"
// //                       style={{ width: `${option.percent}%` }}
// //                       aria-hidden="true"
// //                     ></span>
// //                   )}

// //                   <span className={`poll-icon ${icon}`}>
// //                     <i className={`fa-solid ${glyph}`}></i>
// //                   </span>

// //                   <span id={`hook-option-${index + 1}`} className="poll-label">
// //                     {option.label}
// //                   </span>

// //                   {pollResultsReady && (
// //                     <span className="poll-percent">{option.percent}%</span>
// //                   )}
// //                 </button>
// //               );
// //             })}
// //           </div>
// //         </div> */}

// //         {/* =========================================
// //              OTHER NEWSLETTERS
// //         ========================================== */}

// //         {/* <div className="other-newsletters">
// //           <div className="other-newsletters-left">
// //             <h2>NBT के अन्य न्यूज़लेटर</h2>

// //             <a href={MORE_NEWS_URL} className="view-all">
// //               सभी देखें
// //             </a>
// //           </div>

// //           <button className="newsletter-feedback-btn" onClick={openFeedback}>
// //             अपनी राय दें
// //           </button>
// //         </div> */}

// //         {/* =========================================
// //              FOOTER
// //         ========================================== */}

// //         <Footer />

// //       </div>
// //     </div>
// //   );
// // }



// "use client";
// import Home from "./Home";
// export default function Page() {
//   return <Home />;
// }

// // //             //  Internal tool
"use client";
import InternalTool from "./InternalTool";
export default function Page() {
  return <InternalTool />;
 }
