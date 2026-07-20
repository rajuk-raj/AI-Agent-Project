/**
 * Generate a section — a user request becomes a heading plus bullets.
 *
 * This is the workspace's primary verb. Unlike the rewriter, which reworks one
 * fixed bullet, this decides what the request warrants: reworking existing
 * bullets, writing new ones from the experience notes, or both.
 *
 * Scoring stays a separate call (api/score.js), so the client can show each
 * bullet's verdict as it lands rather than blocking on the whole section.
 */

import { callLLM, handler } from './_llm.js';
import { GENERATE_SCHEMA, GENERATE_SYSTEM, generatePrompt } from './_prompts.js';
import { competencyLabel, SENIORITY } from '../shared/competencyModel.js';
import { checkFormat } from '../shared/scoring.js';

export async function generate({
  request,
  resumeText,
  experienceText = '',
  existingBullets = [],
  gapIds = [],
  seniority = 'PM',
}) {
  if (!request?.trim()) throw new Error('request is required — tell the agent what to write about.');
  if (!resumeText?.trim()) throw new Error('resumeText is required — bullets must be grounded in the source.');

  const { data, usage, model } = await callLLM({
    tool: 'rewrite', // shares the rewriter's model config; same job, wider scope
    system: GENERATE_SYSTEM,
    prompt: generatePrompt({
      request,
      resumeText,
      experienceText,
      existingBullets,
      gapLabels: gapIds.map(competencyLabel),
      seniorityLabel: SENIORITY[seniority]?.label,
    }),
    schema: GENERATE_SCHEMA,
    schemaName: 'generated_section',
    maxOutputTokens: 4000,
  });

  const bullets = (data.bullets ?? []).map((b, i) => {
    const text = b.text.trim();
    return {
      id: `g${Date.now().toString(36)}${i}`,
      text,
      competency: b.competency,
      basedOn: b.basedOn,
      claimsUsed: b.claimsUsed ?? [],
      // Deterministic, so the client can flag a too-long bullet without a call.
      format: checkFormat(text),
    };
  });

  return {
    heading: data.heading?.trim() || 'New section',
    bullets,
    unsupported: data.unsupported ?? [],
    meta: { model, usage },
  };
}

export default handler(async (body) => generate(body));
