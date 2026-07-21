/**
 * Section discovery — what the user can choose to work on.
 *
 * Runs once after the documents are supplied. The agent presents these as
 * options ("which heading?") rather than making the user guess what to type.
 *
 * Points are copied verbatim by contract: the workspace shows the original
 * beside the rewrite, so a silently tidied original makes the comparison a lie.
 */

import { callLLM, handler } from './_llm.js';
import { SECTIONS_SCHEMA, SECTIONS_SYSTEM, sectionsPrompt } from './_prompts.js';

export async function extractSections({ resumeText, experienceText = '' }) {
  if (!resumeText?.trim()) throw new Error('resumeText is required.');

  const { data, usage, model } = await callLLM({
    tool: 'decompose',
    system: SECTIONS_SYSTEM,
    prompt: sectionsPrompt({ resumeText, experienceText }),
    schema: SECTIONS_SCHEMA,
    schemaName: 'document_sections',
    maxOutputTokens: 16000,
  });

  const sections = (data.sections ?? [])
    .filter((s) => (s.points ?? []).length > 0)
    .map((s, i) => ({
      id: `sec${i}`,
      heading: s.heading.trim(),
      // With no notes supplied there is only one document it can have come
      // from. The model tagged a job "experience" on an empty notes field,
      // which filed it under a tab the user had no reason to open.
      source: experienceText.trim() ? s.source : 'resume',
      parentHeading: s.parentHeading?.trim() || null,
      kind: s.kind === 'list' ? 'list' : 'achievements',
      context: s.context,
      points: s.points.map((p, j) => ({ id: `sec${i}p${j}`, text: p.trim() })),
    }));

  // Verbatim audit. The model is told not to edit, but instruction-following
  // is not a guarantee and a paraphrased "original" would corrupt the whole
  // before/after premise.
  const haystack = `${resumeText}\n${experienceText}`.toLowerCase().replace(/\s+/g, ' ');
  const drifted = [];
  for (const s of sections) {
    for (const p of s.points) {
      const needle = p.text.toLowerCase().replace(/\s+/g, ' ').replace(/^[-•*]\s*/, '');
      if (!haystack.includes(needle)) drifted.push(`${s.heading}: “${p.text.slice(0, 60)}…”`);
    }
  }

  return {
    sections,
    warnings: drifted.length
      ? [`${drifted.length} point(s) may have been paraphrased rather than copied: ${drifted[0]}`]
      : [],
    meta: { model, usage },
  };
}

export default handler(async (body) => extractSections(body));
