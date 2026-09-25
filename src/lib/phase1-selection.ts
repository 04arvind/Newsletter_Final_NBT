import type { Article } from './scoring';
import { normalizeForComparison } from './hindi-utils';

export interface SelectionCandidate {
  article: Article;
  trendSignalScore?: number;
  trendKeyword?: string;
  /**
   * Slot ids (`slot_1`..`slot_5`) the ingest-time classifier marked this
   * article eligible for. Authoritative when present: the in-memory predicates
   * below are a second copy of the same rules, and where the two disagree the
   * stored one wins, so a slot can never receive an article that was not
   * classified for it. Omit it and selection behaves exactly as before.
   */
  eligibleSlots?: string[];
  /**
   * Slot 3's trending-entertainment score, 0-100. Kept separate from
   * `trendSignalScore` so it cannot rescale the normalization pool the other
   * slots draw on.
   */
  engagementTrendScore?: number;
}

export interface SelectedArticle extends Article {
  score: number;
  reason: string;
  category: string;
  subscriberValueScore: number;
  slot: number;
  slotTheme: SlotTheme;
}

export type SlotTheme =
  | 'biggest_impact'
  | 'money_life_impact'
  | 'highest_engagement'
  | 'curiosity_discovery'
  | 'big_upcoming_event';

export interface Phase1Selection {
  topStory: SelectedArticle | null;
  todaysTop5: SelectedArticle[];
  last24Hours: SelectedArticle[];
  upcomingEvents: never[];
  hook: {
    type: 'poll';
    question: string;
    options: string[];
    basedOnArticleId: string;
  } | null;
  categoriesUsed: string[];
  storyClustersUsed: string[];
}

interface ScoredCandidate {
  candidate: SelectionCandidate;
  score: number;
  freshness: number;
  category: string;
  storyKeys: string[];
}

const utilityTerms = ['money', 'finance', 'business', 'market', 'stock', 'share', 'gold', 'petrol', 'diesel', 'inflation', 'tax', 'salary', 'job', 'career', 'scheme', 'insurance', 'loan', 'bank', 'price', 'telecom', 'consumer', 'बजट', 'नौकरी', 'रोजगार', 'महंगाई', 'कीमत', 'योजना', 'बीमा', 'लोन', 'बैंक', 'टैक्स', 'सोना', 'पेट्रोल', 'डीजल', 'शेयर'];
const impactTerms = ['government', 'minister', 'cabinet', 'supreme court', 'high court', 'verdict', 'judgment', 'election', 'policy', 'law', 'bill', 'national security', 'army', 'border', 'war', 'conflict', 'disaster', 'earthquake', 'flood', 'cyclone', 'major accident', 'infrastructure', 'economy', 'सरकार', 'मंत्री', 'कैबिनेट', 'सुप्रीम कोर्ट', 'हाई कोर्ट', 'फैसला', 'चुनाव', 'नीति', 'कानून', 'सुरक्षा', 'सेना', 'सीमा', 'युद्ध', 'आपदा', 'भूकंप', 'बाढ़', 'चक्रवात', 'बड़ा हादसा', 'अर्थव्यवस्था'];
const curiosityTerms = ['why', 'how', 'explainer', 'explained', 'what is', 'know the reason', 'research', 'discovery', 'science', 'technology', 'data', 'study', 'unknown', 'hidden', 'surprising', 'unusual', 'क्या है', 'क्यों', 'कैसे', 'जानिए वजह', 'रिसर्च', 'खोज', 'विज्ञान', 'तकनीक', 'आंकड़े', 'अध्ययन', 'अनसुना', 'छिपा', 'हैरान', 'अनोखा'];
const eventTerms = ['launch', 'release', 'final', 'summit', 'election', 'hearing', 'announcement', 'festival', 'match', 'tournament', 'conference', 'लॉन्च', 'रिलीज', 'फाइनल', 'सम्मेलन', 'चुनाव', 'सुनवाई', 'घोषणा', 'त्योहार', 'मुकाबला', 'टूर्नामेंट'];
const engagementTerms = ['bollywood', 'tollywood', 'hollywood', 'movie', 'film', 'cinema', 'celebrity', 'actor', 'actress', 'singer', 'music', 'web series', 'web-series', 'ott', 'streaming', 'youtube', 'influencer', 'reality show', 'trailer', 'creator', 'content creator', 'गाना', 'गायिका', 'गायक', 'फिल्म', 'सिनेमा', 'बॉलीवुड', 'टॉलीवुड', 'हॉलीवुड', 'सेलिब्रिटी', 'अभिनेता', 'अभिनेत्री', 'वेब सीरीज', 'ओटीटी', 'यूट्यूब', 'इन्फ्लुएंसर', 'रियलिटी शो', 'ट्रेलर', 'क्रिएटर'];
const sportsTerms = ['sports', 'cricket', 'football', 'tennis', 'ipl', 'match', 'tournament', 'खेल', 'क्रिकेट', 'फुटबॉल', 'टेनिस', 'मुकाबला', 'टूर्नामेंट'];
const recipeTerms = ['recipe', 'halwa', 'food', 'dish', 'cooking', 'भोग', 'हलवा', 'रेसिपी', 'खाना', 'व्यंजन', 'पकवान'];
const futureHeadlinePattern = /scheduled|upcoming|will be held|to be held|set to|due on|next week|this week|tomorrow|20\d{2}|अगले सप्ताह|अगले हफ्ते|कल|आयोजित होगा|होने वाला|होगा|होगी|होंगे|लॉन्च डेट|रिलीज डेट/i;
const completedEventPattern = /already|was held|ended|out|scored|won|lost|completed|बरकरार|बनाए|बना चुके|बना लिया|आउट|जीत गया|हार गया|समाप्त/i;

function hasEditorialTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text);
  });
}

const categoryRules: Array<[string, RegExp]> = [
  ['sports', /sports|cricket|football|tennis|ipl|match|olympics/i],
  ['business', /business|economy|market|stock|share|finance|company/i],
  ['technology', /tech|technology|ai|gadget|science|isro|space/i],
  ['entertainment', /entertainment|movie|cinema|bollywood|television|actor/i],
  ['world', /world|international|america|iran|russia|ukraine|pakistan/i],
  ['india', /india|delhi|mumbai|राज्य|सरकार|चुनाव|संसद/i],
];

const storyStopwords = new Set([
  'और', 'का', 'के', 'की', 'में', 'से', 'को', 'ने', 'पर', 'यह', 'एक',
  'the', 'and', 'for', 'with', 'from', 'after', 'before', 'in', 'on',
]);

function storyKeysFor(article: Article): string[] {
  const normalized = normalizeForComparison(`${article.title} ${article.keywords.join(' ')}`);
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 2 && !storyStopwords.has(token));
  const keys: string[] = [];
  for (let index = 0; index < tokens.length - 1; index++) {
    keys.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  if (article.storyClusterId) keys.push(`cluster:${article.storyClusterId}`);
  return Array.from(new Set(keys));
}

function sharesStoryKey(item: ScoredCandidate, selectedKeys: Set<string>): boolean {
  return item.storyKeys.some((key) => selectedKeys.has(key));
}

function categoryFor(article: Article): string {
  if (article.category?.trim()) return article.category.trim().toLowerCase();
  const text = `${article.title} ${article.url}`;
  return categoryRules.find(([, rule]) => rule.test(text))?.[0] || 'general';
}

function freshnessFor(publishedAt: string, referenceTime: Date): number {
  const timestamp = new Date(publishedAt).getTime();
  if (!Number.isFinite(timestamp)) return 20;
  const hours = Math.max(0, (referenceTime.getTime() - timestamp) / 3_600_000);
  if (hours <= 1) return 100;
  if (hours <= 3) return 90;
  if (hours <= 6) return 75;
  if (hours <= 12) return 60;
  if (hours <= 24) return 40;
  return 20;
}

function normalize(values: Array<number | undefined>, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const available = values.filter((item): item is number => item !== undefined);
  if (available.length === 1) return 100;
  if (available.length === 0) return undefined;
  const min = Math.min(...available);
  const max = Math.max(...available);
  if (max === min) return 100;
  return ((value - min) / (max - min)) * 100;
}

function weightedAverage(parts: Array<[number | undefined, number]>): number {
  const available = parts.filter(([value]) => value !== undefined) as Array<[number, number]>;
  if (available.length === 0) return 0;
  const weight = available.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return available.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight;
}

function scoreCandidates(candidates: SelectionCandidate[], referenceTime: Date): ScoredCandidate[] {
  const trendValues = candidates.map((item) => item.trendSignalScore);
  return candidates.map((candidate) => {
    const article = candidate.article;
    const freshness = freshnessFor(article.publishedAt, referenceTime);
    const interestParts: Array<[number | undefined, number]> = [
      [normalize(candidates.map((item) => item.article.views24h), article.views24h), 40],
      [normalize(candidates.map((item) => item.article.googleTrendScore), article.googleTrendScore), 30],
      [normalize(candidates.map((item) => item.article.socialBuzzScore), article.socialBuzzScore), 30],
    ];
    const interest = interestParts.some(([value]) => value !== undefined)
      ? weightedAverage(interestParts)
      : normalize(trendValues, candidate.trendSignalScore) || 0;
    const engagement = weightedAverage([
      [normalize(candidates.map((item) => item.article.historicalCtr), article.historicalCtr), 50],
      [normalize(candidates.map((item) => item.article.historicalEngagement), article.historicalEngagement), 30],
      [normalize(candidates.map((item) => item.article.shareRate), article.shareRate), 10],
      [normalize(candidates.map((item) => item.article.commentRate), article.commentRate), 10],
    ]);
    const importance = normalize(
      candidates.map((item) => item.article.editorialImportanceScore),
      article.editorialImportanceScore
    );
    const curiosity = normalize(
      candidates.map((item) => item.article.curiosityScore),
      article.curiosityScore
    );
    const velocity = normalize(
      candidates.map((item) => item.article.viewsVelocity1h ?? item.article.viewsVelocity6h),
      article.viewsVelocity1h ?? article.viewsVelocity6h
    );
    const score = weightedAverage([
      [interest, 25],
      [importance, 20],
      [velocity, 15],
      [engagement, 15],
      [freshness, 10],
      [curiosity, 10],
      [article.isDeveloping ? 100 : article.isBreaking ? 80 : undefined, 5],
    ]);

    return {
      candidate,
      score: Math.round(score * 100) / 100,
      freshness,
      category: categoryFor(article),
      storyKeys: storyKeysFor(article),
    };
  }).sort((a, b) => b.score - a.score || b.freshness - a.freshness);
}

function toSelected(item: ScoredCandidate, reason: string): SelectedArticle {
  const article = item.candidate.article;
  return {
    ...article,
    score: item.score,
    reason,
    category: item.category,
    subscriberValueScore: Math.round(((item.score + item.freshness) / 2) * 100) / 100,
    slot: 0,
    slotTheme: 'biggest_impact',
  };
}

function metricScore(
  item: ScoredCandidate,
  candidates: ScoredCandidate[],
  key: keyof Article
): number | undefined {
  const value = item.candidate.article[key];
  if (typeof value !== 'number') return undefined;
  const values = candidates.map((candidate) => {
    const candidateValue = candidate.candidate.article[key];
    return typeof candidateValue === 'number' ? candidateValue : undefined;
  });
  return normalize(values, value);
}

function slotScore(theme: SlotTheme, item: ScoredCandidate, candidates: ScoredCandidate[]): number {
  const article = item.candidate.article;
  const interest = metricScore(item, candidates, 'views24h') ??
    normalize(candidates.map((candidate) => candidate.candidate.trendSignalScore), item.candidate.trendSignalScore) ?? 0;
  const velocity = metricScore(item, candidates, 'viewsVelocity1h') ?? metricScore(item, candidates, 'viewsVelocity6h');
  const importance = metricScore(item, candidates, 'editorialImportanceScore');
  const curiosity = metricScore(item, candidates, 'curiosityScore');
  const ctr = metricScore(item, candidates, 'historicalCtr');
  const socialBuzz = metricScore(item, candidates, 'socialBuzzScore');
  const shares = metricScore(item, candidates, 'shareRate');
  const comments = metricScore(item, candidates, 'commentRate');
  const utility = metricScore(item, candidates, 'utilityScore') ?? (isMoneyLifeCandidate(article) ? 100 : undefined);
  const revenue = metricScore(item, candidates, 'revenuePotentialScore');
  const novelty = metricScore(item, candidates, 'emotionalScore');

  if (theme === 'biggest_impact') return weightedAverage([[importance, 30], [interest, 25], [velocity, 20], [item.freshness, 15], [importance, 10]]);
  if (theme === 'money_life_impact') return weightedAverage([[utility, 25], [interest, 20], [revenue, 20], [ctr, 15], [importance, 10], [item.freshness, 10]]);
  // Slots 3 and 4 are scored entirely from Google Analytics engagement
  // metrics. While those are unavailable every input is undefined,
  // `weightedAverage` returns 0 for every candidate alike, and the sort below
  // falls through to freshness — the slot stops being ranked at all and simply
  // takes the newest article that passes its theme filter.
  //
  // When that happens, rank on the trend engine's score for the article's topic
  // instead. That score already exists (`trendSignalScore`); no new signal is
  // fetched here. The formulas below are used unchanged whenever GA data is
  // present, so this only ever replaces a result that carried no information.
  const trendSignal = normalize(
    candidates.map((candidate) => candidate.candidate.trendSignalScore),
    item.candidate.trendSignalScore
  );

  if (theme === 'highest_engagement') {
    // Slot 3 ranks on the trending-entertainment signal and does not wait on
    // Google Analytics. Only slot-3 candidates carry the score, so it is
    // normalized against them alone.
    const engagementTrend = normalize(
      candidates.map((candidate) => candidate.candidate.engagementTrendScore),
      item.candidate.engagementTrendScore
    );
    if (engagementTrend !== undefined) return engagementTrend;

    const hasHistoricalEngagement = article.historicalCtr !== undefined || article.historicalEngagement !== undefined;
    const engagementScore = hasHistoricalEngagement
      ? weightedAverage([[ctr, 30], [socialBuzz, 25], [shares, 20], [comments, 15], [curiosity, 10]])
      : weightedAverage([[socialBuzz, 35], [ctr, 30], [velocity, 25], [curiosity, 10]]);
    return engagementScore > 0 ? engagementScore : trendSignal ?? 0;
  }
  if (theme === 'curiosity_discovery') {
    const curiosityScore = weightedAverage([[curiosity, 30], [ctr, 25], [novelty, 20], [shares, 15], [utility, 10]]);
    return curiosityScore > 0 ? curiosityScore : trendSignal ?? 0;
  }
  return weightedAverage([[interest, 30], [importance, 25], [metricScore(item, candidates, 'googleTrendScore'), 20], [curiosity, 15], [revenue, 10]]);
}

const slotDefinitions: Array<{ slot: number; theme: SlotTheme; reason: string; upcoming?: boolean }> = [
  { slot: 1, theme: 'biggest_impact', reason: 'सबसे बड़ी सार्वजनिक असर वाली खबर' },
  { slot: 2, theme: 'money_life_impact', reason: 'पाठकों की जेब या रोजमर्रा की जिंदगी पर सीधा असर' },
  { slot: 3, theme: 'highest_engagement', reason: 'सबसे ज्यादा क्लिक, शेयर और बातचीत की संभावना' },
  { slot: 4, theme: 'curiosity_discovery', reason: 'नई जानकारी और खोज की मजबूत संभावना' },
  { slot: 5, theme: 'big_upcoming_event', reason: 'आने वाले बड़े और सत्यापित कार्यक्रम के लिए वापसी की वजह', upcoming: true },
];

export function selectPhase1Newsletter(
  candidates: SelectionCandidate[],
  windowEnd = new Date()
): Phase1Selection {
  const unique = Array.from(new Map(candidates.map((item) => [item.article.url, item])).values());
  const scored = scoreCandidates(unique, windowEnd);
  const top = scored[0] ? toSelected(scored[0], 'सबसे मजबूत उपलब्ध रुचि, ताजगी और ट्रेंड सिग्नल') : null;
  const selectedUrls = new Set(top ? [top.url] : []);
  const selectedClusters = new Set(top?.storyClusterId ? [top.storyClusterId] : []);
  const selectedStoryKeys = new Set(scored[0]?.storyKeys || []);
  const categoryCounts = new Map<string, number>();
  const todaysTop5: SelectedArticle[] = [];

  for (const definition of slotDefinitions) {
    const available = scored.filter((item) => {
      if (selectedUrls.has(item.candidate.article.url)) return false;
      if (sharesStoryKey(item, selectedStoryKeys)) return false;
      // Stored classification decides slot membership when it is available.
      const storedSlots = item.candidate.eligibleSlots;
      if (storedSlots && !storedSlots.includes(`slot_${definition.slot}`)) return false;
      if (definition.upcoming && !isUpcomingEvent(item.candidate.article)) return false;
      if (definition.theme === 'biggest_impact' && !isImpactCandidate(item.candidate.article)) return false;
      if (definition.theme === 'money_life_impact' && !isMoneyLifeCandidate(item.candidate.article)) return false;
      if (definition.theme === 'highest_engagement' && !isEngagementCandidate(item.candidate.article)) return false;
      if (definition.theme === 'curiosity_discovery' && !isCuriosityCandidate(item.candidate.article)) return false;
      if (item.category !== 'general' && (categoryCounts.get(item.category) || 0) >= 2) return false;
      return true;
    });
    const chosen = available.sort(
      (left, right) => slotScore(definition.theme, right, scored) - slotScore(definition.theme, left, scored) || right.freshness - left.freshness
    )[0];
    if (!chosen) continue;
    const selected = toSelected(chosen, definition.reason);
    selected.score = Math.round(slotScore(definition.theme, chosen, scored) * 100) / 100;
    selected.slot = definition.slot;
    selected.slotTheme = definition.theme;
    todaysTop5.push(selected);
    selectedUrls.add(chosen.candidate.article.url);
    if (chosen.candidate.article.storyClusterId) selectedClusters.add(chosen.candidate.article.storyClusterId);
    chosen.storyKeys.forEach((key) => selectedStoryKeys.add(key));
    categoryCounts.set(chosen.category, (categoryCounts.get(chosen.category) || 0) + 1);
  }

  const dayAgo = windowEnd.getTime() - 24 * 60 * 60 * 1000;
  const last24Hours: SelectedArticle[] = [];
  for (const item of scored) {
    if (last24Hours.length === 3) break;
      const timestamp = new Date(item.candidate.article.publishedAt).getTime();
      const eligible = Number.isFinite(timestamp) && timestamp >= dayAgo &&
        timestamp < windowEnd.getTime() &&
        !selectedUrls.has(item.candidate.article.url) &&
        !sharesStoryKey(item, selectedStoryKeys);
    if (!eligible) continue;
    const selected = toSelected(item, 'पिछले 24 घंटे की ताजा और महत्वपूर्ण खबर');
    selected.slot = 0;
    selected.slotTheme = 'biggest_impact';
    last24Hours.push(selected);
    selectedUrls.add(item.candidate.article.url);
    if (item.candidate.article.storyClusterId) selectedClusters.add(item.candidate.article.storyClusterId);
    item.storyKeys.forEach((key) => selectedStoryKeys.add(key));
  }

  const categoriesUsed = Array.from(new Set([...(top ? [top.category] : []), ...todaysTop5.map((item) => item.category), ...last24Hours.map((item) => item.category)]));
  const storyClustersUsed = Array.from(new Set([...todaysTop5, ...last24Hours].map((item) => item.storyClusterId).filter(Boolean) as string[]));

  return {
    topStory: top,
    todaysTop5,
    last24Hours,
    upcomingEvents: [],
    hook: top
      ? {
          type: 'poll',
          question: `क्या आपको लगता है कि ${top.title} का असर लंबे समय तक रहेगा?`,
          options: ['हां, असर बड़ा होगा', 'कुछ समय तक असर रहेगा', 'असर सीमित रहेगा', 'कहना मुश्किल है'],
          basedOnArticleId: top.articleId || top.url,
        }
      : null,
    categoriesUsed,
    storyClustersUsed,
  };
}

function isUpcomingEvent(article: Article): boolean {
  const text = article.title;
  return futureHeadlinePattern.test(text) && hasEditorialTerm(text, eventTerms) && !completedEventPattern.test(text);
}

function isEngagementCandidate(article: Article): boolean {
  const text = `${article.category || ''} ${article.subcategory || ''} ${article.topic || ''} ${article.title} ${(article.entities || []).join(' ')} ${article.keywords.join(' ')}`;
  return hasEditorialTerm(text, engagementTerms) && !hasEditorialTerm(text, sportsTerms);
}

function articleText(article: Article): string {
  return `${article.title} ${article.description || ''} ${article.topic || ''} ${article.category || ''} ${article.subcategory || ''} ${article.keywords.join(' ')} ${article.url}`;
}

function isImpactCandidate(article: Article): boolean {
  const text = articleText(article);
  return hasEditorialTerm(text, impactTerms) && !hasEditorialTerm(text, engagementTerms) && !hasEditorialTerm(text, recipeTerms);
}

function isMoneyLifeCandidate(article: Article): boolean {
  const text = articleText(article);
  return hasEditorialTerm(text, utilityTerms) && !hasEditorialTerm(text, recipeTerms) && !hasEditorialTerm(text, engagementTerms);
}

function isCuriosityCandidate(article: Article): boolean {
  const text = articleText(article);
  return hasEditorialTerm(text, curiosityTerms) && !hasEditorialTerm(text, recipeTerms) && !hasEditorialTerm(text, engagementTerms) && !hasEditorialTerm(text, utilityTerms);
}
