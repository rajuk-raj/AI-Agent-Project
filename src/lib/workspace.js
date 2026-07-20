/**
 * Workspace operations.
 *
 * The unit of work is one section the user picked. Every point already written
 * in that section is rewritten one-for-one, so the user can see their original
 * beside the improvement and regenerate any single point they dislike.
 *
 * The self-correction loop (score, retry a different angle, refuse to
 * fabricate) runs per point, invisibly. What surfaces is the verdict.
 */

import * as api from './api.js';
import { optimizeBullet, OUTCOME } from '../../shared/optimizeLoop.js';
import { REASON } from '../../shared/scoring.js';

export const POINT = {
  PENDING: 'pending',
  WORKING: 'working',
  IMPROVED: 'improved',
  NEEDS_DATA: 'needs_data',
  REFUSED: 'refused',
  UNCHANGED: 'unchanged',
};

/** Plain-language explanation of what happened to a point. */
function explain(res) {
  if (res.outcome === OUTCOME.ACCEPTED) return { state: POINT.IMPROVED, note: null };

  if (res.reason === REASON.WOULD_REQUIRE_FABRICATION) {
    return {
      state: POINT.REFUSED,
      note: `Left alone — improving it would have meant claiming “${
        res.fabricatedClaims?.[0] ?? 'something not in your documents'
      }”, which isn’t in your documents.`,
    };
  }
  if (res.reason === REASON.NO_QUANTIFIABLE_DATA) {
    return {
      state: POINT.NEEDS_DATA,
      note: 'Your documents don’t say what changed here. Add the result to your notes, then regenerate.',
    };
  }
  if (res.reason === REASON.DUPLICATES_EXISTING) {
    return {
      state: POINT.REFUSED,
      note: 'Left alone — every stronger version borrowed a result that already belongs to another point.',
    };
  }
  return {
    state: POINT.UNCHANGED,
    note: 'Couldn’t improve this beyond the original without stretching the facts.',
  };
}

/** One-time analysis: what sections exist, and how the resume currently reads. */
export async function analyzeDocuments(
  { resumeText, experienceText, seniority },
  { onStage = () => {} } = {}
) {
  onStage('Finding the sections in your documents…');
  const secs = await api.extractSections({ resumeText, experienceText });

  onStage('Checking which PM competencies your resume already shows…');
  const dec = await api.decompose({ resumeText, experienceText });
  const map = await api.mapCompetency({ bullets: dec.bullets, seniority });

  return {
    sections: secs.sections,
    warnings: secs.warnings,
    resumeBullets: map.bullets,
    coverage: map.coverage,
    analyzedAt: Date.now(),
  };
}

/** Everything already claimed elsewhere, so a rewrite can't quietly reuse it. */
function siblingClaims(analysis, excludeText) {
  return [
    ...(analysis?.resumeBullets ?? []).map((b) => b.text),
    ...(analysis?.sections ?? []).flatMap((s) => s.points.map((p) => p.text)),
  ].filter((t) => t && t !== excludeText);
}

/**
 * Rewrite one point. Used both for the initial pass and for per-point
 * regeneration — `avoid` carries versions the user already rejected, so a
 * regenerate genuinely changes angle instead of returning the same sentence.
 */
export async function rewritePoint(session, { point, targetCompetency, avoid = [], instruction }) {
  const analysis = session.analysis;
  const gapIds = analysis?.coverage?.gapIds ?? [];

  // A user instruction is a different job from a blind retry: apply exactly
  // what they asked, and refuse if it can't be done without inventing a fact.
  if (instruction) {
    const res = await api.refine({
      bullet: point.rewrite ?? point.text,
      instruction,
      resumeText: session.resumeText,
      experienceText: session.experienceText,
      otherBullets: siblingClaims(analysis, point.text),
    });

    if (res.refused) {
      return {
        ...point,
        state: POINT.REFUSED,
        note: `Declined: ${res.refused}`,
        usage: { calls: 1, inputTokens: 0, outputTokens: 0 },
      };
    }

    return {
      ...point,
      state: POINT.IMPROVED,
      note: null,
      rewrite: res.text,
      claimsUsed: res.claimsUsed,
      attempts: (point.attempts ?? 1) + 1,
      history: [...(point.history ?? []), res.text],
      usage: { calls: 1, inputTokens: 0, outputTokens: 0 },
    };
  }

  const res = await optimizeBullet(
    {
      bullet: { id: point.id, text: point.text },
      targetCompetency: targetCompetency ?? inferCompetency(analysis, point) ?? 'EXECUTION',
      resumeText: session.resumeText,
      experienceText: session.experienceText,
      gapIds,
      otherBullets: siblingClaims(analysis, point.text),
    },
    {
      rewriteFn: (args) =>
        api.rewrite({
          ...args,
          // Force a different angle on regeneration.
          attempt: Math.max(args.attempt, avoid.length ? 1 : 0),
          previousAttempts: [...avoid, ...args.previousAttempts],
        }),
      scoreFn: api.score,
    }
  );

  const { state, note } = explain(res);

  return {
    ...point,
    state,
    note,
    rewrite: res.best?.rewrite ?? null,
    score: res.best?.composite ?? null,
    scores: res.best?.scores ?? null,
    claimsUsed: res.best?.claimsUsed ?? [],
    attempts: res.attempts.length,
    history: [...(point.history ?? []), ...(res.best ? [res.best.rewrite] : [])],
    usage: res.usage,
  };
}

/** Best guess at what a point should demonstrate, from the earlier analysis. */
function inferCompetency(analysis, point) {
  const match = (analysis?.resumeBullets ?? []).find((b) => b.text === point.text);
  return match?.potentialCompetency ?? match?.competency;
}

/**
 * Rewrite every point in a section, reporting each as it lands so the user
 * watches progress rather than waiting on the whole section.
 */
export async function rewriteSection(session, section, { onPoint = () => {} } = {}) {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const points = section.points.map((p) => ({ ...p, state: POINT.PENDING }));
  onPoint([...points]);

  for (let i = 0; i < points.length; i++) {
    points[i] = { ...points[i], state: POINT.WORKING };
    onPoint([...points]);

    try {
      const done = await rewritePoint(session, { point: points[i] });
      usage.calls += done.usage.calls;
      usage.inputTokens += done.usage.inputTokens;
      usage.outputTokens += done.usage.outputTokens;
      points[i] = done;
    } catch (e) {
      points[i] = { ...points[i], state: POINT.UNCHANGED, note: `Failed: ${e.message}` };
    }
    onPoint([...points]);
  }

  return { points, usage };
}
