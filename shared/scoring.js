/**
 * Scoring rubric (PRD §7.3) and reason-code routing (§7.4).
 *
 * Format/length is computed here in code, not by the model — that removes 15%
 * of the composite from LLM judgment entirely, and the metric-detection helper
 * removes part of the specificity criterion too. Provider-independent.
 */

export const WEIGHTS = {
  competency: 0.30,
  star: 0.30,
  specificity: 0.25,
  format: 0.15,
};

export const THRESHOLD = 70;
export const MAX_BULLET_CHARS = 150;
export const MAX_RETRIES_PER_BULLET = 3;

/**
 * Reason codes are what make retries meaningful. A retry can fix bad writing;
 * it cannot invent a metric that isn't in the source documents. Routing each
 * failure to the mechanism that can actually fix it saves calls and, more
 * importantly, removes the pressure toward fabrication.
 */
export const REASON = {
  ACCEPTED: 'ACCEPTED',
  WEAK_PHRASING: 'WEAK_PHRASING',
  NO_STAR_STRUCTURE: 'NO_STAR_STRUCTURE',
  FORMAT_FAIL: 'FORMAT_FAIL',
  NO_QUANTIFIABLE_DATA: 'NO_QUANTIFIABLE_DATA',
  WOULD_REQUIRE_FABRICATION: 'WOULD_REQUIRE_FABRICATION',
  /**
   * The rewrite appropriated an achievement that belongs to a different bullet.
   *
   * Distinct from fabrication: the claim IS in the source, so a naive
   * "is this supported?" check passes it. But the result duplicates an
   * accomplishment already on the resume, so the candidate ends up claiming the
   * same win twice. Retryable — the rewriter can work from this bullet's own
   * material instead.
   */
  DUPLICATES_EXISTING: 'DUPLICATES_EXISTING',
};

export const ROUTE = {
  ACCEPT: 'accept',
  RETRY: 'retry',
  CLARIFY: 'clarify',
  FLAG: 'flag',
};

/** Which reason codes a retry can actually do something about. */
export const ROUTING = {
  [REASON.ACCEPTED]: ROUTE.ACCEPT,
  [REASON.WEAK_PHRASING]: ROUTE.RETRY,
  [REASON.NO_STAR_STRUCTURE]: ROUTE.RETRY,
  [REASON.FORMAT_FAIL]: ROUTE.RETRY,
  [REASON.NO_QUANTIFIABLE_DATA]: ROUTE.CLARIFY,
  [REASON.WOULD_REQUIRE_FABRICATION]: ROUTE.FLAG,
  [REASON.DUPLICATES_EXISTING]: ROUTE.RETRY,
};

/**
 * Strong, specific openers. Deliberately excludes weak leads ("Responsible for",
 * "Helped", "Worked on", "Assisted") and vague ones ("Managed", "Handled") that
 * describe a role rather than an accomplishment.
 */
export const ACTION_VERBS = new Set([
  'accelerated', 'achieved', 'aligned', 'architected', 'automated', 'built',
  'championed', 'consolidated', 'converted', 'created', 'cut', 'defined',
  'delivered', 'deprecated', 'designed', 'diagnosed', 'doubled', 'drove',
  'eliminated', 'enabled', 'established', 'expanded', 'grew', 'identified',
  'implemented', 'improved', 'increased', 'influenced', 'initiated',
  'instrumented', 'integrated', 'introduced', 'launched', 'led', 'migrated',
  'negotiated', 'optimized', 'orchestrated', 'overhauled', 'partnered',
  'pioneered', 'pitched', 'prioritized', 'proposed', 'prototyped', 'rebuilt',
  'recovered', 'redesigned', 'reduced', 'refocused', 'released', 'removed',
  'repositioned', 'resolved', 'restructured', 'scaled', 'scoped', 'secured',
  'shipped', 'simplified', 'standardized', 'streamlined', 'tripled',
  'unblocked', 'unified', 'validated',
]);

const WEAK_OPENERS = [
  'responsible for', 'helped', 'worked on', 'assisted', 'participated',
  'involved in', 'tasked with', 'contributed to', 'supported',
];

/**
 * LaTeX handling is an EXPORT concern, not a quality one.
 *
 * `% $ & # _` are ordinary prose characters — and `%` in particular appears in
 * nearly every strong quantified bullet. Penalizing them would dock points from
 * exactly the bullets we most want to reward. They are escaped on export
 * instead (see escapeLatex) and cost nothing here.
 *
 * `\ { } ~ ^` are different: in plain resume prose they almost always indicate
 * a parsing artifact or malformed generation, so they do count against format.
 */
const LATEX_ESCAPABLE = /[%$&#_]/g;
const LATEX_BROKEN = /[{}~^\\]/g;

/** Escape a bullet for pasting into a LaTeX template. Used at export only. */
export function escapeLatex(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%$&#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Deterministic format check. Returns a 0–100 score plus the specific issues,
 * so the UI can explain exactly why a bullet failed rather than showing a number.
 */
export function checkFormat(text) {
  const issues = [];
  const bullet = String(text ?? '').trim();

  if (!bullet) {
    return { score: 0, issues: ['Bullet is empty.'], pass: false, length: 0 };
  }

  if (bullet.length > MAX_BULLET_CHARS) {
    issues.push(`${bullet.length} characters — over the ${MAX_BULLET_CHARS} limit.`);
  }
  if (/[\r\n]/.test(bullet)) {
    issues.push('Contains a line break; bullets must be a single line.');
  }

  const broken = bullet.match(LATEX_BROKEN);
  if (broken) {
    issues.push(`Contains stray character(s) suggesting malformed text: ${[...new Set(broken)].join(' ')}`);
  }

  const lower = bullet.toLowerCase();
  const weakOpener = WEAK_OPENERS.find((w) => lower.startsWith(w));
  if (weakOpener) {
    issues.push(`Opens with a weak phrase ("${weakOpener}") instead of an action verb.`);
  } else {
    const firstWord = lower.split(/[\s,]+/)[0]?.replace(/[^a-z]/g, '') ?? '';
    if (!ACTION_VERBS.has(firstWord)) {
      issues.push(`Does not open with a recognized action verb (starts with "${firstWord}").`);
    }
  }

  // Each distinct issue costs 25 points; four or more issues floors the score.
  const score = Math.max(0, 100 - issues.length * 25);
  return {
    score,
    issues,
    pass: issues.length === 0,
    length: bullet.length,
    // Informational only — does not affect the score. Signals to the export
    // path that escapeLatex() should run before the bullet enters a template.
    needsLatexEscaping: bullet.match(LATEX_ESCAPABLE) !== null,
  };
}

/**
 * Detects whether a bullet contains a quantified result. Used to distinguish
 * "written badly" (retryable) from "no data available" (route to clarification).
 */
export function detectMetrics(text) {
  const s = String(text ?? '');
  const patterns = [
    /\d+(?:\.\d+)?\s?%/g,                         // 34%, 12.5 %
    /[$€£₹]\s?\d[\d,.]*\s?[kmb]?\b/gi,            // $2.4M, ₹50k
    /\b\d+(?:\.\d+)?\s?x\b/gi,                    // 3x, 2.5x
    /\b\d[\d,]*\+?\s?(?:users?|customers?|accounts?|merchants?|requests?|hours?|days?|weeks?|months?|bps)\b/gi,
    /\bfrom\s+\d[\d,.]*\s*(?:%|to)\s*\d[\d,.]*/gi, // from 42 to 78
  ];
  const found = patterns.flatMap((re) => s.match(re) ?? []);
  return { hasMetric: found.length > 0, matches: [...new Set(found)] };
}

/**
 * Weighted composite. Inputs are 0–100; `format` is supplied by checkFormat(),
 * the rest by the model.
 */
export function computeComposite({ competency, star, specificity, format }) {
  const parts = { competency, star, specificity, format };
  for (const [k, v] of Object.entries(parts)) {
    if (typeof v !== 'number' || Number.isNaN(v)) {
      throw new Error(`computeComposite: "${k}" must be a number, received ${v}`);
    }
  }
  const composite =
    competency * WEIGHTS.competency +
    star * WEIGHTS.star +
    specificity * WEIGHTS.specificity +
    format * WEIGHTS.format;

  return Math.round(composite * 10) / 10;
}

/**
 * Decides what happens to a scored bullet.
 *
 * `fabricationRisk` comes from the scorer's explicit check for claims that
 * appear in the rewrite but not in the source documents. It short-circuits
 * everything else — a bullet that can only be improved by inventing something
 * is never retried and never silently accepted.
 */
export function deriveOutcome({
  scores,
  format,
  rewrite,
  fabricationRisk = false,
  duplicatesAnotherBullet = false,
  sourceHasMetric = null,
  attempt = 0,
}) {
  const composite = computeComposite({ ...scores, format: format.score });

  if (fabricationRisk) {
    return { reason: REASON.WOULD_REQUIRE_FABRICATION, route: ROUTE.FLAG, composite };
  }

  /**
   * Checked before the threshold, deliberately. A duplicated achievement tends
   * to score WELL — it borrowed a strong, quantified claim — so a
   * score-first check would accept it. Correctness gates quality here.
   */
  if (duplicatesAnotherBullet) {
    return {
      reason: REASON.DUPLICATES_EXISTING,
      route: attempt >= MAX_RETRIES_PER_BULLET ? ROUTE.FLAG : ROUTE.RETRY,
      composite,
    };
  }

  if (composite >= THRESHOLD) {
    return { reason: REASON.ACCEPTED, route: ROUTE.ACCEPT, composite };
  }

  // Missing data, not bad writing — retrying cannot help. Ask the user instead.
  const { hasMetric } = detectMetrics(rewrite);
  if (scores.specificity < THRESHOLD && !hasMetric && sourceHasMetric === false) {
    return { reason: REASON.NO_QUANTIFIABLE_DATA, route: ROUTE.CLARIFY, composite };
  }

  // Retryable failures, most-specific first.
  let reason = REASON.WEAK_PHRASING;
  if (!format.pass) reason = REASON.FORMAT_FAIL;
  else if (scores.star < THRESHOLD) reason = REASON.NO_STAR_STRUCTURE;

  const exhausted = attempt >= MAX_RETRIES_PER_BULLET;
  return {
    reason,
    route: exhausted ? ROUTE.FLAG : ROUTE.RETRY,
    composite,
  };
}
