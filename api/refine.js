/**
 * Refine one bullet against a user instruction.
 *
 * Powers "rephrase" and "regenerate with a prompt". The guardrail matters more
 * here than anywhere else in the product: the user is actively asking for a
 * change, and the most common ask — "make it stronger", "add a number" — is
 * exactly the one that invites fabrication. When the instruction cannot be
 * followed honestly, the tool refuses and says what is missing.
 */

import { callLLM, handler } from './_llm.js';
import { REFINE_SCHEMA, REFINE_SYSTEM, refinePrompt } from './_prompts.js';
import { checkFormat } from '../shared/scoring.js';

export async function refine({
  bullet,
  instruction,
  resumeText,
  experienceText = '',
  otherBullets = [],
}) {
  if (!bullet?.trim()) throw new Error('bullet is required.');
  if (!instruction?.trim()) throw new Error('instruction is required.');
  if (!resumeText?.trim()) throw new Error('resumeText is required.');

  const { data, usage, model } = await callLLM({
    tool: 'rewrite',
    system: REFINE_SYSTEM,
    prompt: refinePrompt({ bullet, instruction, resumeText, experienceText, otherBullets }),
    schema: REFINE_SCHEMA,
    schemaName: 'refined_bullet',
    maxOutputTokens: 1500,
  });

  const text = data.text.trim();
  return {
    text,
    claimsUsed: data.claimsUsed ?? [],
    // Non-null means the agent declined to follow the instruction as given.
    refused: data.refused,
    format: checkFormat(text),
    meta: { model, usage },
  };
}

export default handler(async (body) => refine(body));
