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
import {
  indexJd,
  matchBullet,
  coverJd,
  missingTerms,
  JD_MATCH_TARGET,
} from '../../shared/jdMatch.js';

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

/**
 * Attach the JD match to a point: the original's score and the rewrite's, so
 * the box shows movement rather than a bare number. Computed in code — see
 * shared/jdMatch.js — so it costs no call and is identical on every render.
 */
function withMatch(point, jdIndex) {
  if (!jdIndex) return { ...point, match: null, originalMatch: null };
  return {
    ...point,
    originalMatch: matchBullet(point.text, jdIndex),
    match: point.rewrite ? matchBullet(point.rewrite, jdIndex) : null,
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
  const jdIndex = indexJd(session.jd?.jd);

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
      return withMatch(
        {
          ...point,
          state: POINT.REFUSED,
          note: `Declined: ${res.refused}`,
          usage: { calls: 1, inputTokens: 0, outputTokens: 0 },
        },
        jdIndex
      );
    }

    return withMatch(
      {
        ...point,
        state: POINT.IMPROVED,
        note: null,
        rewrite: res.text,
        claimsUsed: res.claimsUsed,
        attempts: (point.attempts ?? 1) + 1,
        history: [...(point.history ?? []), res.text],
        usage: { calls: 1, inputTokens: 0, outputTokens: 0 },
      },
      jdIndex
    );
  }

  const res = await optimizeBullet(
    {
      bullet: { id: point.id, text: point.text },
      targetCompetency: targetCompetency ?? inferCompetency(analysis, point) ?? 'EXECUTION',
      resumeText: session.resumeText,
      experienceText: session.experienceText,
      gapIds,
      otherBullets: siblingClaims(analysis, point.text),
      // Aim every point at the posting, then report what was actually reached.
      jdTarget: jdIndex ? JD_MATCH_TARGET : 0,
    },
    {
      // Both are pure functions over the indexed JD: no call, no cost, so the
      // loop can consult them on every attempt.
      jdMatchFn: jdIndex ? (text) => matchBullet(text, jdIndex) : null,
      jdFeedbackFn: jdIndex ? (text) => missingTerms(text, jdIndex) : null,
      rewriteFn: (args) =>
        api.rewrite({
          ...args,
          // Force a different angle on regeneration.
          attempt: Math.max(args.attempt, avoid.length ? 1 : 0),
          previousAttempts: [...avoid, ...args.previousAttempts],
          // Lens for emphasis and wording. Deliberately NOT passed to scoreFn:
          // the scorer's fabrication check must treat only the candidate's own
          // documents as evidence, or a JD requirement could be laundered in.
          jd: session.jd?.jd ?? null,
        }),
      scoreFn: api.score,
    }
  );

  const { state, note } = explain(res);
  const accepted = res.outcome === OUTCOME.ACCEPTED;

  return withMatch({
    ...point,
    state,
    note,
    // "Left as-is" has to mean the original stands. Presenting a rejected
    // draft as the final line contradicted the badge beside it, and with a JD
    // loaded it could show the match *dropping* — advertising a downgrade as
    // the tailored version. The draft stays visible under "working".
    rewrite: accepted ? res.best?.rewrite ?? null : null,
    rejectedDraft: accepted ? null : res.best?.rewrite ?? null,
    star: accepted ? res.best?.star ?? null : null,
    score: res.best?.composite ?? null,
    scores: res.best?.scores ?? null,
    claimsUsed: res.best?.claimsUsed ?? [],
    attempts: res.attempts.length,
    history: [...(point.history ?? []), ...(res.best ? [res.best.rewrite] : [])],
    usage: res.usage,
  }, jdIndex);
}

/** Best guess at what a point should demonstrate, from the earlier analysis. */
function inferCompetency(analysis, point) {
  const match = (analysis?.resumeBullets ?? []).find((b) => b.text === point.text);
  return match?.potentialCompetency ?? match?.competency;
}

/**
 * How much of the target posting this section now speaks to.
 *
 * Section-level rather than per-point, because "answers requirement 4" is a
 * property of the section as a whole — no single bullet should be expected to
 * cover a job description on its own.
 */
export function sectionCoverage(session, points = []) {
  const jdIndex = indexJd(session.jd?.jd);
  return coverJd(
    points.map((p) => p.rewrite ?? p.text),
    jdIndex
  );
}

/**
 * Rewrite every point in a section, reporting each as it lands so the user
 * watches progress rather than waiting on the whole section.
 */
export async function rewriteSection(session, section, { onPoint = () => {} } = {}) {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const jdIndex = indexJd(session.jd?.jd);
  // Seed each box with the original's JD match before any rewriting, so the
  // user sees the starting position rather than a number appearing from nowhere.
  const points = section.points.map((p) => withMatch({ ...p, state: POINT.PENDING }, jdIndex));
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
