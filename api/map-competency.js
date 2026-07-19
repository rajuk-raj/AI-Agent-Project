/**
 * Step 3 — Competency Mapping.
 *
 * Tags each bullet with the PM competency it demonstrates and how strongly,
 * then computes Competency Coverage. This replaces JD gap analysis in v1 and
 * is what makes the no-JD path the primary feature rather than a fallback.
 */

import { callLLM, handler } from './_llm.js';
import { COMPETENCY_SCHEMA, COMPETENCY_SYSTEM, competencyPrompt } from './_prompts.js';
import { computeCoverage, DEFAULT_SENIORITY, SENIORITY, STRENGTH } from '../shared/competencyModel.js';

export async function mapCompetency({ bullets, seniority = DEFAULT_SENIORITY }) {
  if (!Array.isArray(bullets) || bullets.length === 0) {
    throw new Error('bullets[] is required and must be non-empty.');
  }
  if (!SENIORITY[seniority]) {
    throw new Error(`Unknown seniority "${seniority}". Expected one of: ${Object.keys(SENIORITY).join(', ')}`);
  }

  const { data, usage, model } = await callLLM({
    tool: 'competency',
    system: COMPETENCY_SYSTEM,
    prompt: competencyPrompt({ bullets }),
    schema: COMPETENCY_SCHEMA,
    schemaName: 'competency_assessment',
    maxOutputTokens: 16000,
  });

  // Index-match rather than assuming array order. The model returns an explicit
  // index per assessment precisely so a dropped or reordered item is detectable
  // instead of silently shifting every downstream tag by one.
  const byIndex = new Map((data.assessments ?? []).map((a) => [a.index, a]));

  const assessed = bullets.map((b, i) => {
    const a = byIndex.get(i);
    if (!a) {
      return {
        ...b,
        competency: 'NONE',
        strength: STRENGTH.NONE,
        rationale: 'Not assessed - the model returned no result for this bullet.',
        hasQuantifiedResult: false,
        unassessed: true,
      };
    }
    return {
      ...b,
      competency: a.competency,
      // Falls back to the assigned competency so the rewriter always has a target.
      potentialCompetency: a.potentialCompetency ?? a.competency,
      strength: a.strength,
      rationale: a.rationale,
      hasQuantifiedResult: a.hasQuantifiedResult,
      unassessed: false,
    };
  });

  const missing = assessed.filter((b) => b.unassessed);
  const coverage = computeCoverage(assessed, seniority);

  /**
   * Anything not already strong is a rewrite candidate.
   *
   * Do NOT gate on strength === 'weak'. Models vary in whether they call an
   * outcome-free duty statement "weak" or "none", and gating on "weak" made
   * that labelling difference silently drop bullets from the pipeline — the
   * worst possible failure, because duty statements are exactly what this
   * product exists to rewrite. Sections that legitimately contain no
   * accomplishments are excluded by section, which is a fact about the resume
   * rather than a model judgment call.
   */
  const REWRITABLE_SECTIONS = new Set(['EXPERIENCE', 'PROJECTS', 'OTHER']);
  const rewriteIds = assessed
    .filter(
      (b) =>
        b.strength !== STRENGTH.STRONG &&
        REWRITABLE_SECTIONS.has(b.section) &&
        !b.unassessed
    )
    .map((b) => b.id);

  return {
    bullets: assessed,
    coverage,
    rewriteIds,
    warnings: missing.length
      ? [`${missing.length} bullet(s) came back unassessed: ${missing.map((b) => b.id).join(', ')}`]
      : [],
    meta: { model, usage },
  };
}

export default handler(async (body) => mapCompetency(body));
