/**
 * Deterministic intent router for the codeDeft chat box (web dashboard and VS Code).
 *
 * It replaces "any message containing figma/existing/extract" with an explainable scoring model:
 *  1. A Figma URL anywhere in the message is extracted exactly (trailing punctuation and wrapping
 *     brackets removed) and always routes to the Figma workflow.
 *  2. Otherwise each intent accumulates weighted evidence from phrases. Strong phrases ("reusable",
 *     "can I reuse") are decisive; ambiguous words ("existing", "extract") only count together with
 *     other evidence. Question forms ("where is", "how does") add evidence for search.
 *  3. The best intent wins only if it clears a threshold and beats search by a margin; ties and weak
 *     evidence fall back to repository search, the safest action (read-only, always available).
 */
export type ChatIntent = 'figma' | 'reuse' | 'search' | 'empty';
export type ChatRoute = {
  intent: ChatIntent;
  /** Exact Figma URL when one was found. */
  figmaUrl?: string;
  /** Text to use as the search query or reuse requirement (the message without the URL). */
  query: string;
  /** Evidence that decided the route, for display and debugging. */
  reasons: string[];
  scores: Record<'figma' | 'reuse' | 'search', number>;
};

const FIGMA_URL = /https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/[^\s<>"'`]+/i;
const TRAILING = /[)\]}>.,;:!?'"`]+$/;

/** Returns the first Figma link in `text`, without trailing punctuation, or undefined. */
export function extractFigmaUrl(text: string): string | undefined {
  const match = text.match(FIGMA_URL);
  if (!match) return undefined;
  let url = match[0];
  // Strip punctuation that ends a sentence or closes a bracket, but keep balanced parentheses inside the URL.
  while (TRAILING.test(url)) {
    const last = url.at(-1)!;
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
    url = url.slice(0, -1);
  }
  try { const parsed = new URL(url); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url.replace(/^http:/i, 'https:') : undefined; } catch { return undefined; }
}

type Rule = { intent: 'figma' | 'reuse' | 'search'; re: RegExp; weight: number; label: string };
const RULES: Rule[] = [
  // Explicit Figma commands without a URL ("figma", "import figma design", "connect to figma").
  { intent: 'figma', re: /^\s*(?:(?:import|open|read|connect(?:\s+to)?|load)\s+)?(?:a\s+|the\s+|my\s+)?figma(?:\s+(?:design|file|frame|url|link))?\s*[.!?]?\s*$/i, weight: 10, label: 'Figma command' },
  { intent: 'figma', re: /\b(?:import|read|load|convert)\b.{0,30}\bfigma\b/i, weight: 4, label: 'asks to import from Figma' },
  // Strong reuse evidence.
  { intent: 'reuse', re: /\breus(?:e|able|ing)\b/i, weight: 5, label: 'mentions reuse' },
  { intent: 'reuse', re: /\b(?:duplicat(?:e|ed|ion)|copy[-\s]?pasted?|near[-\s]?duplicate)\b/i, weight: 4, label: 'mentions duplication' },
  { intent: 'reuse', re: /\b(?:already\s+(?:have|exists?|implemented)|something\s+similar|similar\s+(?:code|logic|component|function))\b/i, weight: 4, label: 'asks for existing equivalents' },
  { intent: 'reuse', re: /\b(?:instead\s+of\s+(?:writing|building)|avoid\s+(?:rewriting|duplicating))\b/i, weight: 4, label: 'wants to avoid rewriting' },
  // Weak reuse evidence: only meaningful with other signals.
  { intent: 'reuse', re: /\b(?:existing|extract|shared|common)\b/i, weight: 1.5, label: 'weak reuse word' },
  // Search evidence.
  { intent: 'search', re: /^\s*(?:where|how|what|which|why|when|who|show|explain|find|list|does|is|are)\b/i, weight: 3, label: 'question or lookup' },
  { intent: 'search', re: /\b(?:implemented|defined|configured|handled|called|located|used)\b/i, weight: 1.5, label: 'asks how/where code works' }
];
const THRESHOLD = 4;
const MARGIN = 1;

export function routeChatMessage(input: string): ChatRoute {
  const text = input.trim();
  const scores = { figma: 0, reuse: 0, search: 0 };
  if (!text) return { intent: 'empty', query: '', reasons: [], scores };
  const figmaUrl = extractFigmaUrl(text);
  const query = (figmaUrl ? text.replace(text.match(FIGMA_URL)![0], ' ') : text).replace(/\s+/g, ' ').trim();
  if (figmaUrl) return { intent: 'figma', figmaUrl, query, reasons: ['contains a Figma link'], scores: { ...scores, figma: Infinity } };

  const reasons: Record<keyof typeof scores, string[]> = { figma: [], reuse: [], search: [] };
  for (const rule of RULES) if (rule.re.test(text)) { scores[rule.intent] += rule.weight; reasons[rule.intent].push(rule.label); }
  const best = (['figma', 'reuse'] as const).reduce((a, b) => scores[b] > scores[a] ? b : a);
  if (scores[best] >= THRESHOLD && scores[best] >= scores.search + MARGIN) return { intent: best, query, reasons: reasons[best], scores };
  return { intent: 'search', query, reasons: reasons.search.length ? reasons.search : ['default: repository search'], scores };
}
