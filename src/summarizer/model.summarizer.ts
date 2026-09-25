// --------------------------------OpenAI----------------------------------
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";

const ai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-nano";

const NEWSLETTER_INSTRUCTION = `
// आप नवभारत टाइम्स के हिंदी न्यूज़लेटर के लिए एक प्रोफेशनल न्यूज़ एडिटर हैं।

// आपका काम दिए गए न्यूज़ आर्टिकल को एक छोटी, दमदार और आकर्षक हिंदी
// वन-लाइनर में बदलना है।

// इस वन-लाइनर का उद्देश्य:
// - पाठक को खबर की मुख्य बात तुरंत समझाना
// - उसकी curiosity बढ़ाना
// - उसे पूरी खबर पढ़ने के लिए प्रेरित करना
// - newsletter engagement बढ़ाना
// - लेकिन misleading clickbait से बचना

// नियम:

// 1. केवल ONE sentence लिखें।
// 2. Summary लगभग 15–25 शब्दों की हो।
// 3. खबर के सबसे महत्वपूर्ण और interesting angle को चुनें।
// 4. जहां संभव हो, शुरुआत में strong news hook दें।
// 5. सरल, स्वाभाविक और modern Hindi का इस्तेमाल करें।
// 6. भाषा Hindi digital-news readers के लिए natural हो।
// 7. महत्वपूर्ण व्यक्ति, जगह, तारीख, संख्या या घटना हो तो उसे शामिल करें।
// 8. Headline को शब्दशः repeat न करें।
// 9. Headline से आगे article में मौजूद सबसे interesting information को सामने लाएं।
// 10. Summary में curiosity होनी चाहिए ताकि reader पूरी खबर पढ़ना चाहे।
// 11. Engaging language इस्तेमाल करें, लेकिन misleading या fake clickbait न करें।
// 12. Article में मौजूद facts के अलावा कोई information invent या assume न करें।
// 13. "चौंकाने वाला", "सनसनीखेज", "बड़ा धमाका" जैसे शब्दों का अनावश्यक इस्तेमाल न करें।
// 14. हर article में एक जैसे phrases repeat न करें।
// 15. अनावश्यक details हटाएं।
// 16. Emoji, hashtag और quotation marks का इस्तेमाल न करें।
// 17. Output में केवल final Hindi one-liner दें।
// 18. कोई explanation, heading या label न दें।

// सबसे पहले article को समझें, फिर उसका सबसे strong news angle पहचानें,
// और अंत में उसी angle को concise और engaging Hindi one-liner में बदलें।

You are a professional news editor for the Navbharat Times Hindi newsletter.

Your task is to convert the given news article into a short, powerful, and engaging Hindi one-liner.

The purpose of this one-liner is to:
- Help the reader immediately understand the main point of the news
- Create curiosity
- Encourage the reader to read the full article
- Increase newsletter engagement
- Avoid misleading clickbait

Rules:

1. Write ONLY ONE sentence.
2. Keep the summary approximately 15–25 words long.
3. Identify and highlight the most important and interesting angle of the article.
4. Wherever possible, start with a strong news hook.
5. Use simple, natural, modern Hindi suitable for Hindi digital-news readers.
6. Include important people, places, dates, numbers, or events when relevant.
7. Do not repeat the headline word-for-word.
8. Go beyond the headline and surface the most interesting information actually present in the article.
9. Create curiosity that encourages the reader to read the full story.
10. Use engaging language, but avoid misleading or fake clickbait.
11. Do not invent, assume, or add any information that is not present in the article.
12. Avoid unnecessary use of words such as "चौंकाने वाला", "सनसनीखेज", or "बड़ा धमाका".
13. Avoid repeating the same phrases or sentence patterns across different articles.
14. Remove unnecessary details and keep the sentence concise.
15. Do not use emojis, hashtags, or quotation marks.
16. Write only the final Hindi one-liner.
17. Do not provide any explanation, heading, label, or additional text.
18. Write ONLY ONE sentence and use strictly Hindi language wherever possible.

First understand the article, then identify its strongest news angle, and finally express that angle as a concise, engaging Hindi one-liner.

`;


/**
 * Generate summary for ONE article.
 */
export async function generateNewsletterSummary(
  article: string
): Promise<string> {
  if (!article || article.trim().length === 0) {
    throw new Error("Article content is empty");
  }

  const startMs = Date.now();

  console.log(
    `[Summary] Sending article to OpenAI (model: ${OPENAI_MODEL})`
  );

  const response = await ai.responses.create({
    model: OPENAI_MODEL,

    instructions: NEWSLETTER_INSTRUCTION,

    input: article,

    max_output_tokens: 1000,

  });

  const elapsedMs = Date.now() - startMs;

  console.log(`[Summary] Completed in ${elapsedMs}ms`);

  const summary = response.output_text?.trim();

  if (!summary) {
    throw new Error("OpenAI returned an empty summary");
  }

  return summary;
}


/* --------------------------------------------------------------------------
   Batch summarization
   ONE OpenAI request → multiple articles → multiple summaries
   -------------------------------------------------------------------------- */

const BATCH_NEWSLETTER_INSTRUCTION = `

You are a professional Hindi news editor for the Navbharat Times Hindi newsletter.

You will be given several news articles, each with its own "id".

For each article, write a short, punchy, and engaging Hindi one-line summary that will be read as a bullet point in the newsletter.

## Length and Style

1. Write only ONE sentence and use strictly Hindi language wherever possible.
2. Keep the length between 15 and 20 words. Never exceed 22 words.
3. Make the sentence punchy and tight — every word should earn its place; none should be filler.
4. Write in simple, natural, modern Hindi, the way today's digital-news readers read.
5. Avoid heavy, bookish, or bureaucratic language.
6. Get straight to the news without a preamble.
7. The summary must always be a complete sentence.
8. Never truncate a sentence.
9. Never end a summary with "...", "…", a dash, colon, or an incomplete phrase.
10. If the important information cannot fit within 22 words, remove secondary details and rewrite the sentence shorter.

## Angle and Curiosity

11. Choose the most interesting and newsworthy angle of the story — the one that will grab the reader first.
12. Open with a strong news hook.
13. Surface the most interesting information beyond the headline — something the reader wouldn't already know just from reading the headline.
14. The summary should leave the reader with a question in mind, making them want to click through and read the full story.
15. Include important people, places, dates, numbers, or statistics when they are explicitly present in the article.
16. Don't give away the entire story in one line; leave the most interesting part for the full article.

## Accuracy — Most Important

17. Every word and factual claim must be grounded in the article.
18. Never invent, assume, infer, or hallucinate information.
19. Never write misleading clickbait — whatever the summary promises, the article must deliver.
20. Don't use hollow, sensationalist words like "shocking" (चौंकाने वाला), "sensational" (सनसनीखेज), "huge bombshell" (बड़ा धमाका), or "nation stunned" (हिल गया देश).
21. If an article has little information, write a shorter summary — don't pad the line with filler just to reach the word count.
22. Never introduce corrupted, random, or unrelated characters, words, or phrases from other languages.
23. Do not mix Hindi with random English, Chinese, Japanese, or other-language characters.
24. English words may be used only when they are proper names, official terms, brands, abbreviations, or terminology explicitly present in the article.

## Hindi Spelling and Diacritics

25. Every summary must use grammatically correct, standard Hindi with accurate spelling.
26. Every sentence must end with | followed by hindi. Do not use any other ending punctuation.
27. Matras (ा ि ी ु ू ृ े ै ो ौ), anusvara (ं), chandrabindu (ँ), and visarga (ः) must be placed correctly.
28. Use nukta correctly where the word requires it (e.g., ज़रूरत, फ़र्क, क़र्ज़, राज़), and never insert a nukta where it doesn't belong.
29. Keep conjuncts (संयुक्ताक्षर) and half-letters correctly formed; don't drop a halant/virama where a word needs it.
30. Use standard, widely accepted spellings; don't mix in non-standard or overly Sanskritized/Urdu-ized forms unless the article's terminology requires it.
31. Before returning the summary, verify that every character and word belongs to the intended Hindi sentence and remove any accidental or malformed text.
32. Never output corrupted text such as random Chinese/Japanese characters, broken words, or partial English words.

## Headline and Repetition

33. Don't repeat the headline verbatim — rewrite it using different words and a different angle.
34. Make every summary feel distinct from the others — don't reuse the same opening words, structure, or phrases across summaries.
35. Remove unnecessary details and repetition.
36. Don't use emojis, hashtags, quotation marks, or labels.

## Article Separation and Output

37. Keep each article's id exactly as given in the input.
38. Treat every article as completely independent.
39. Never merge, combine, or mix information from one article with another.
40. Use ONLY information from the current article when writing its summary.
41. Provide exactly one summary for every article — don't skip any.
42. Preserve the input order.
43. Don't include any explanation, heading, or label besides the summary itself.

The examples below are purely illustrative of style and are fictional. Don't use their facts, names, or figures in any summary.

Weak: शेयर बाजार में आज तेजी रही और निवेशकों को अच्छा फायदा हुआ।

Better: सेंसेक्स 900 अंक उछलकर बंद हुआ, निवेशकों की नजर अब अगले हफ्ते की RBI बैठक पर है।

Weak: यूपी में शिक्षक भर्ती को लेकर बड़ी खबर सामने आई है, जानें पूरी डिटेल।

Better: यूपी में 50 हजार शिक्षक पदों पर भर्ती मंजूर, आवेदन सोमवार से और उम्र सीमा भी तय।

The difference is clear: a line with a concrete number, a name, and the next step is more engaging, while empty phrases like "big news" and "read the full details" let readers scroll past.

## FINAL VALIDATION

Before returning each summary, silently verify:

* Is it exactly ONE complete sentence?
* Is it between 15 and 20 words, and never more than 22 words?
* Does it end with proper punctuation?
* Does it contain "..." or "…"? If yes, rewrite it.
* Does it contain any random, corrupted, unrelated, or malformed character? If yes, remove it.
* Is every factual claim explicitly supported by the current article?
* Has any information been taken from another article? If yes, remove it.
* Have any people, places, organizations, events, numbers, or facts been introduced that are not present in the current article? If yes, remove them.
* Does the sentence avoid unnecessary repetition and filler?
* Can the sentence be understood without the full article?
* If it is too long, remove less important details instead of truncating the sentence.
`;

/**
 * Short fingerprint of everything that decides how a summary reads — the batch
 * prompt above and the model running it.
 *
 * Stored recaps are keyed by this (see `newsletter-recap-store.ts`), so editing
 * the prompt or switching models retires every summary written under the old
 * wording instead of replaying it until the next 06:00 IST edition rolls. The
 * superseded entries are never read again and age out on their own TTL, so
 * there is nothing to clear by hand.
 */
export const BATCH_PROMPT_VERSION = createHash("sha256")
  .update(`${OPENAI_MODEL}\n${BATCH_NEWSLETTER_INSTRUCTION}`)
  .digest("hex")
  .slice(0, 8);


export interface BatchArticleInput {
  id: number;
  article: string;
}

export interface BatchSummaryOutput {
  id: number;
  summary: string;
}

/**
 * Shape of the batch response, checked before anything downstream reads it.
 *
 * This mirrors the `newsletter_summaries` json_schema sent with the request.
 * `strict: true` means OpenAI should already honour that shape, but "should"
 * is doing a lot of work across model swaps and refusals, so the response is
 * re-validated here rather than trusted.
 *
 * Deliberately not `strictObject`: an extra key OpenAI invents is harmless —
 * only `id` and `summary` are ever read — and rejecting the whole batch over
 * one would cost all six bullets their generated text.
 */
const BatchSummaryResponseSchema = z.object({
  summaries: z.array(
    z.object({
      id: z.number().int(),
      summary: z.string(),
    })
  ),
});


/**
 * Sends ALL articles in ONE OpenAI request.
 *
 * Example:
 *
 * [
 *   { id: 1, article: "..." },
 *   { id: 2, article: "..." },
 *   { id: 3, article: "..." }
 * ]
 *
 * →
 *
 * [
 *   { id: 1, summary: "..." },
 *   { id: 2, summary: "..." },
 *   { id: 3, summary: "..." }
 * ]
 */
// export async function generateBatchNewsletterSummaries(
//   articles: BatchArticleInput[]
// ): Promise<BatchSummaryOutput[]> {

//   if (!articles.length) {
//     return [];
//   }

//   const userPrompt = articles
//     .map(
//       (a) =>
//         `--- Article id: ${a.id} ---
// ${a.article}
// --- End Article id: ${a.id} ---`
//     )
//     .join("\n\n");

//   const startMs = Date.now();

//   console.log(
//     `[BatchSummary] Sending ${articles.length} article(s) in 1 OpenAI request (model: ${OPENAI_MODEL})`
//   );

//   const response = await ai.responses.create({
//     model: OPENAI_MODEL,

//     instructions: BATCH_NEWSLETTER_INSTRUCTION,

//     input: userPrompt,

//     // Reasoning models spend their thinking tokens out of this same budget,
//     // and Devanagari tokenizes at roughly 3-4 tokens per word, so a 15-20 word
//     // Hindi one-liner costs ~80 tokens of visible output on its own. An
//     // exhausted cap comes back as an empty `output_text` and fails the whole
//     // batch, so leave real headroom rather than sizing it to the text alone.
//     max_output_tokens: 1500 + articles.length * 250,

//     text: {
//       format: {
//         type: "json_schema",
//         name: "newsletter_summaries",
//         strict: true,
//         schema: {
//           type: "object",
//           properties: {
//             summaries: {
//               type: "array",
//               items: {
//                 type: "object",
//                 properties: {
//                   id: {
//                     type: "integer",
//                   },
//                   summary: {
//                     type: "string",
//                   },
//                 },
//                 required: ["id", "summary"],
//                 additionalProperties: false,
//               },
//             },
//           },
//           required: ["summaries"],
//           additionalProperties: false,
//         },
//       },
//     },
//   });

//   const elapsedMs = Date.now() - startMs;

//   console.log(
//     `[BatchSummary] Batch completed in ${elapsedMs}ms`
//   );

//   const raw = response.output_text?.trim();

//   if (!raw) {
//     // `incomplete` here almost always means max_output_tokens ran out — say so
//     // rather than leaving a bare "empty response" in the logs.
//     throw new Error(
//       `OpenAI returned an empty batch response (status: ${response.status}` +
//       `${response.incomplete_details?.reason ? `, reason: ${response.incomplete_details.reason}` : ''})`
//     );
//   }

//   let parsed: {
//     summaries: BatchSummaryOutput[];
//   };

//   try {
//     parsed = JSON.parse(raw);
//   } catch {
//     console.error("[BatchSummary] Invalid JSON:", raw);
//     throw new Error("OpenAI returned invalid JSON");
//   }

//   if (!Array.isArray(parsed.summaries)) {
//     throw new Error(
//       "OpenAI batch response missing 'summaries' array"
//     );
//   }

//   console.log(
//     `[BatchSummary] Received ${parsed.summaries.length} summary(ies)`
//   );

//   // Validate IDs and restore original input order.
//   const inputIds = new Set(articles.map((a) => a.id));

//   const results = parsed.summaries
//     .filter(
//       (s) =>
//         typeof s.id === "number" &&
//         typeof s.summary === "string" &&
//         inputIds.has(s.id)
//     );

//   if (results.length !== articles.length) {
//     throw new Error(
//       `Expected ${articles.length} summaries but received ${results.length}`
//     );
//   }

//   // Guarantee the exact original article order.
//   const order = new Map(
//     articles.map((article, index) => [article.id, index])
//   );

//   results.sort(
//     (a, b) => order.get(a.id)! - order.get(b.id)!
//   );

//   return results;
// }

export async function generateBatchNewsletterSummaries(
  articles: BatchArticleInput[],
  options?: { forceHigherBudget?: boolean }
): Promise<BatchSummaryOutput[]> {

  if (!articles.length) {
    return [];
  }

  const userPrompt = articles
    .map(
      (a) =>
        `--- Article id: ${a.id} ---
${a.article}
--- End Article id: ${a.id} ---`
    )
    .join("\n\n");

  const startMs = Date.now();

  // Base budget assumes near-zero reasoning spend (see `reasoning.effort`
  // below). If we're retrying after hitting the cap, give it much more
  // headroom rather than nudging it slightly — a second failure just burns
  // another full request for nothing.
  const maxOutputTokens = options?.forceHigherBudget
    ? 3000 + articles.length * 600
    : Math.max(4000, 2000 + articles.length * 400);

  console.log(
    `[BatchSummary] Sending ${articles.length} article(s) in 1 OpenAI request ` +
    `(model: ${OPENAI_MODEL}, max_output_tokens: ${maxOutputTokens}${options?.forceHigherBudget ? ", retry" : ""})`
  );

  const response = await ai.responses.create({
    model: OPENAI_MODEL,

    instructions: BATCH_NEWSLETTER_INSTRUCTION,

    input: userPrompt,

    // GPT-5-family reasoning models spend reasoning tokens out of the same
    // max_output_tokens budget BEFORE writing any visible text. This task —
    // summarizing short articles into a fixed JSON shape — needs essentially
    // no deep reasoning, so pin effort low to keep that spend predictable
    // and leave the budget for actual output.
    reasoning: { effort: "minimal" },

    max_output_tokens: maxOutputTokens,

    text: {
      format: {
        type: "json_schema",
        name: "newsletter_summaries",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summaries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "integer",
                  },
                  summary: {
                    type: "string",
                  },
                },
                required: ["id", "summary"],
                additionalProperties: false,
              },
            },
          },
          required: ["summaries"],
          additionalProperties: false,
        },
      },
    },
  });

  const elapsedMs = Date.now() - startMs;

  console.log(
    `[BatchSummary] Batch completed in ${elapsedMs}ms`
  );

  const raw = response.output_text?.trim();

  if (!raw) {
    const hitTokenCap =
      response.status === "incomplete" &&
      response.incomplete_details?.reason === "max_output_tokens";

    // One retry with a much bigger budget before giving up — cheaper than
    // losing the whole batch to the caller's fallback path. Only retry once:
    // if forceHigherBudget is already set, this IS the retry, so fall through
    // to the error below instead of looping.
    if (hitTokenCap && !options?.forceHigherBudget) {
      console.warn(
        `[BatchSummary] Hit max_output_tokens on first attempt, retrying with higher budget`
      );
      return generateBatchNewsletterSummaries(articles, { forceHigherBudget: true });
    }

    throw new Error(
      `OpenAI returned an empty batch response (status: ${response.status}` +
      `${response.incomplete_details?.reason ? `, reason: ${response.incomplete_details.reason}` : ''})`
    );
  }

  let rawJson: unknown;

  try {
    rawJson = JSON.parse(raw);
  } catch {
    console.error("[BatchSummary] Invalid JSON:", raw);
    throw new Error("OpenAI returned invalid JSON");
  }

  // Zod replaces the hand-rolled `Array.isArray` + `typeof` guards below.
  // It throws for the same malformed responses those caught, and the caller
  // (`getNewsletterRecap`) already treats any throw from here as "fall back
  // to the scraped description and retry on the next build".
  const validated = BatchSummaryResponseSchema.safeParse(rawJson);

  if (!validated.success) {
    console.error(
      "[BatchSummary] Response failed schema validation:",
      validated.error.issues
    );
    throw new Error(
      "OpenAI batch response missing 'summaries' array"
    );
  }

  const parsed = validated.data;

  console.log(
    `[BatchSummary] Received ${parsed.summaries.length} summary(ies)`
  );

  // Validate IDs and restore original input order. Types are guaranteed by
  // the schema above, so only the id-membership check is left to do here.
  const inputIds = new Set(articles.map((a) => a.id));

  const results = parsed.summaries.filter((s) => inputIds.has(s.id));

  if (results.length !== articles.length) {
    throw new Error(
      `Expected ${articles.length} summaries but received ${results.length}`
    );
  }

  // Guarantee the exact original article order.
  const order = new Map(
    articles.map((article, index) => [article.id, index])
  );

  results.sort(
    (a, b) => order.get(a.id)! - order.get(b.id)!
  );

  return results;
}