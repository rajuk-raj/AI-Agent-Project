/**
 * Step 2 — Resume Decomposition.
 *
 * Breaks resume text into individually addressable bullets with metadata.
 * Verbatim by contract: every later step compares against the original text,
 * and the fabrication guardrail is meaningless if the "original" was already
 * silently cleaned up here.
 */

import { callLLM, handler } from './_llm.js';
import { DECOMPOSE_SCHEMA, DECOMPOSE_SYSTEM, decomposePrompt } from './_prompts.js';

export async function decompose({ resumeText, experienceText = '' }) {
  if (!resumeText || !resumeText.trim()) {
    throw new Error('resumeText is required.');
  }

  const { data, usage, model } = await callLLM({
    tool: 'decompose',
    system: DECOMPOSE_SYSTEM,
    prompt: decomposePrompt({ resumeText, experienceText }),
    schema: DECOMPOSE_SCHEMA,
    schemaName: 'decomposed_resume',
    // A dense two-page resume can yield 25+ bullets with metadata; on a
    // reasoning model the thinking budget rides on top of that.
    maxOutputTokens: 16000,
  });

  const bullets = (data.bullets ?? []).map((b, i) => ({
    id: `b${i}`,
    text: b.text.trim(),
    section: b.section,
    company: b.company,
    role: b.role,
    period: b.period,
  }));

  // Verbatim check. The model is instructed not to edit, but instruction-
  // following is not a guarantee, and a silently "improved" original would
  // corrupt every downstream comparison. Cheap to verify, so verify.
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s%$.,-]/g, '').trim();
  const haystack = normalize(resumeText);
  const notVerbatim = bullets.filter((b) => !haystack.includes(normalize(b.text)));

  return {
    bullets,
    warnings: notVerbatim.length
      ? [
          `${notVerbatim.length} of ${bullets.length} extracted bullets do not appear verbatim in the source. ` +
            `They may have been paraphrased: ${notVerbatim.map((b) => b.id).join(', ')}`,
        ]
      : [],
    meta: { model, usage, bulletCount: bullets.length },
  };
}

export default handler(async (body) => decompose(body));
