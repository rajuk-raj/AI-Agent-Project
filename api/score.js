/**
 * Step 5 — Self-Scorer.
 *
 * Hybrid by design: format and length are computed in code (checkFormat), the
 * three judgment criteria come from the model, and the composite is assembled
 * here. That keeps 15% of the score out of model judgment entirely and makes
 * the format portion perfectly reproducible.
 *
 * Returns a reason code, not just a number — the reason is what routes the
 * bullet to a retry, a clarifying question, or a human-review flag.
 */

import { callLLM, handler } from './_llm.js';
import { SCORE_SCHEMA, SCORE_SYSTEM, scorePrompt } from './_prompts.js';
import { COMPETENCIES } from '../shared/competencyModel.js';
import { checkFormat, deriveOutcome } from '../shared/scoring.js';

export async function score({
  original,
  rewrite: rewriteText,
  targetCompetency,
  resumeText,
  experienceText = '',
  attempt = 0,
  otherBullets = [],
}) {
  if (!rewriteText?.trim()) throw new Error('rewrite is required.');

  const competency = COMPETENCIES.find((c) => c.id === targetCompetency);
  if (!competency) throw new Error(`Unknown targetCompetency "${targetCompetency}".`);

  // Deterministic first — no API call needed and it never disagrees with itself.
  const format = checkFormat(rewriteText);

  const { data, usage, model } = await callLLM({
    tool: 'score',
    system: SCORE_SYSTEM,
    prompt: scorePrompt({
      original,
      rewrite: rewriteText,
      targetCompetency,
      competencyDescription: competency.shows,
      resumeText,
      experienceText,
      otherBullets,
    }),
    schema: SCORE_SCHEMA,
    schemaName: 'bullet_score',
    maxOutputTokens: 2000,
  });

  const scores = {
    competency: data.competencySignal,
    star: data.starCompliance,
    specificity: data.specificity,
  };

  const outcome = deriveOutcome({
    scores,
    format,
    rewrite: rewriteText,
    fabricationRisk: data.fabricationRisk,
    duplicatesAnotherBullet: data.duplicatesAnotherBullet,
    sourceHasMetric: data.sourceHasMetric,
    attempt,
  });

  return {
    scores: { ...scores, format: format.score },
    composite: outcome.composite,
    reason: outcome.reason,
    route: outcome.route,
    format,
    fabricationRisk: data.fabricationRisk,
    fabricatedClaims: data.fabricatedClaims ?? [],
    duplicatesAnotherBullet: data.duplicatesAnotherBullet,
    duplicatedFrom: data.duplicatedFrom ?? null,
    sourceHasMetric: data.sourceHasMetric,
    rationale: data.rationale,
    meta: { model, usage },
  };
}

export default handler(async (body) => score(body));
