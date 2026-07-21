/**
 * Step 4 — STAR Rewriter.
 *
 * Rewrites one bullet. Deliberately single-bullet: the retry loop lives in the
 * client orchestrator, so each serverless invocation stays one LLM call and
 * comfortably inside the free-tier function timeout.
 */

import { callLLM, handler } from './_llm.js';
import { REWRITE_SCHEMA, REWRITE_SYSTEM, rewritePrompt } from './_prompts.js';
import { COMPETENCIES } from '../shared/competencyModel.js';

export async function rewrite({
  bullet,
  targetCompetency,
  resumeText,
  experienceText = '',
  attempt = 0,
  previousAttempts = [],
  gapIds = [],
  otherBullets = [],
  // Lens only — never added to the documents the fabrication check trusts.
  jd = null,
  // Set on a retry that is chasing the posting's vocabulary, not accuracy.
  jdFocus = null,
}) {
  if (!bullet?.text) throw new Error('bullet.text is required.');
  if (!resumeText?.trim()) throw new Error('resumeText is required — rewrites must be grounded in the source.');

  const competency = COMPETENCIES.find((c) => c.id === targetCompetency);
  if (!competency) {
    throw new Error(`Unknown targetCompetency "${targetCompetency}".`);
  }

  const { data, usage, model } = await callLLM({
    tool: 'rewrite',
    system: REWRITE_SYSTEM,
    prompt: rewritePrompt({
      bullet,
      targetCompetency,
      competencyDescription: competency.shows,
      resumeText,
      experienceText,
      attempt,
      previousAttempts,
      isGapCompetency: gapIds.includes(targetCompetency),
      otherBullets,
      jd,
      jdFocus,
    }),
    schema: REWRITE_SCHEMA,
    schemaName: 'bullet_rewrite',
    maxOutputTokens: 2000,
  });

  return {
    rewrite: data.rewrite.trim(),
    claimsUsed: data.claimsUsed ?? [],
    rationale: data.rationale,
    // A null result means the source states no outcome for this work — the
    // UI says so rather than presenting a STAR bullet that has no R.
    star: data.star ?? null,
    attempt,
    meta: { model, usage },
  };
}

export default handler(async (body) => rewrite(body));
