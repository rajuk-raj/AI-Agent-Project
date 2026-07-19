/**
 * Step 8 — Clarification pass.
 *
 * Generates targeted questions for bullets the agent could not strengthen
 * because the source contains no supporting data. This is the alternative to
 * the failure mode the whole design exists to avoid: inventing a plausible
 * metric because the rubric demanded one.
 *
 * Optional by contract. The output is complete without it.
 */

import { callLLM, handler } from './_llm.js';
import { QUESTIONS_SCHEMA, QUESTIONS_SYSTEM, questionsPrompt } from './_prompts.js';

export const MAX_QUESTIONS = 5;

export async function generateQuestions({ bullets }) {
  if (!Array.isArray(bullets) || bullets.length === 0) {
    return { questions: [], meta: null };
  }

  const { data, usage, model } = await callLLM({
    tool: 'questions',
    system: QUESTIONS_SYSTEM,
    prompt: questionsPrompt({ bullets }),
    schema: QUESTIONS_SCHEMA,
    schemaName: 'clarifying_questions',
    maxOutputTokens: 2000,
  });

  const known = new Set(bullets.map((b) => b.id));

  /**
   * One question per bullet, enforced in code.
   *
   * The prompt asks for this too, but asking did not work — the model fired
   * three questions at a single bullet on the first run. Three questions about
   * one line of a resume reads as an interrogation and people abandon the
   * form. The model orders best-first, so taking the first per bullet keeps
   * its ranking while guaranteeing the cap.
   */
  const seen = new Set();
  const questions = (data.questions ?? [])
    .filter((q) => known.has(q.bulletId))
    .filter((q) => {
      if (seen.has(q.bulletId)) return false;
      seen.add(q.bulletId);
      return true;
    })
    .slice(0, MAX_QUESTIONS);

  return { questions, meta: { model, usage } };
}

export default handler(async (body) => generateQuestions(body));
