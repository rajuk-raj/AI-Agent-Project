/**
 * Turning the candidate's answers into legitimate source material.
 *
 * Once someone tells us "support tickets dropped by about a third", that is a
 * fact they have asserted about their own work — exactly as valid as anything
 * in the resume. Folding answers into the source context is what lets the
 * fabrication check pass a rewrite that uses them: the claim genuinely IS
 * supported now.
 *
 * Answers are labelled as candidate-provided so the provenance stays auditable
 * rather than being silently merged into the original documents.
 */

/** Answers that add no information — don't pollute the source context with them. */
const EMPTY_ANSWER = /^(n\/?a|none|no|nothing|idk|i don'?t know|not sure|skip|-+)?$/i;

export function isUsableAnswer(answer) {
  const a = String(answer ?? '').trim();
  return a.length > 1 && !EMPTY_ANSWER.test(a);
}

/**
 * @param {Array<{bulletId:string, question:string, answer:string}>} answers
 * @returns {string} A block to append to experienceText, or '' if nothing usable.
 */
export function buildAnswerContext(answers = []) {
  const usable = answers.filter((a) => isUsableAnswer(a.answer));
  if (!usable.length) return '';

  const lines = usable.map(
    (a) => `Q: ${a.question}\nA: ${String(a.answer).trim()}`
  );

  return [
    'The candidate was asked about work their documents did not quantify, and answered:',
    '',
    ...lines,
    '',
    'These answers are candidate-provided facts and may be used in rewrites, exactly like the resume itself.',
  ].join('\n');
}

/** Which bullets have at least one usable answer and are worth re-running. */
export function bulletsToRerun(answers = []) {
  return [
    ...new Set(answers.filter((a) => isUsableAnswer(a.answer)).map((a) => a.bulletId)),
  ];
}

/** Merge the answer block into existing experience-doc text. */
export function mergeIntoSource(experienceText = '', answers = []) {
  const block = buildAnswerContext(answers);
  if (!block) return experienceText;
  return experienceText.trim() ? `${experienceText.trim()}\n\n---\n\n${block}` : block;
}
