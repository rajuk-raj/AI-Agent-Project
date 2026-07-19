/**
 * Steps 4-6 — the rewrite / score / route loop for a single bullet.
 *
 * Dependencies are injected rather than imported so this can be unit-tested
 * with stubs (no API key, no cost, no flakiness) and reused by both the dev
 * harness and the browser orchestrator. The loop is where the agent's
 * self-correction actually happens, so it deserves deterministic tests.
 */

import { MAX_RETRIES_PER_BULLET, ROUTE, REASON } from './scoring.js';

export const OUTCOME = {
  ACCEPTED: 'accepted',
  NEEDS_CLARIFICATION: 'needs_clarification',
  FLAGGED: 'flagged',
};

/**
 * @param {object} input
 * @param {object} input.bullet             { id, text, ... }
 * @param {string} input.targetCompetency
 * @param {string} input.resumeText
 * @param {string} [input.experienceText]
 * @param {string[]} [input.gapIds]         Competencies missing from the resume.
 * @param {object} deps
 * @param {Function} deps.rewriteFn
 * @param {Function} deps.scoreFn
 * @param {Function} [deps.onProgress]      Called with a log line per step.
 */
export async function optimizeBullet(
  {
    bullet,
    targetCompetency,
    resumeText,
    experienceText = '',
    gapIds = [],
    otherBullets = [],
  },
  { rewriteFn, scoreFn, onProgress = () => {} }
) {
  const attempts = [];
  const usage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, calls: 0 };

  const addUsage = (meta) => {
    usage.inputTokens += meta.usage.inputTokens;
    usage.outputTokens += meta.usage.outputTokens;
    usage.thinkingTokens += meta.usage.thinkingTokens;
    usage.calls += 1;
  };

  for (let attempt = 0; attempt <= MAX_RETRIES_PER_BULLET; attempt++) {
    const r = await rewriteFn({
      bullet,
      targetCompetency,
      resumeText,
      experienceText,
      attempt,
      previousAttempts: attempts.map((a) => a.rewrite),
      gapIds,
      otherBullets,
    });
    addUsage(r.meta);

    const s = await scoreFn({
      original: bullet.text,
      rewrite: r.rewrite,
      targetCompetency,
      resumeText,
      experienceText,
      attempt,
      otherBullets,
    });
    addUsage(s.meta);

    attempts.push({
      attempt,
      rewrite: r.rewrite,
      rationale: r.rationale,
      claimsUsed: r.claimsUsed,
      composite: s.composite,
      scores: s.scores,
      reason: s.reason,
      fabricatedClaims: s.fabricatedClaims,
      formatIssues: s.format.issues,
    });

    onProgress(
      `${bullet.id} attempt ${attempt + 1}: ${s.composite}% (${s.reason})`
    );

    if (s.route === ROUTE.ACCEPT) {
      return finish(OUTCOME.ACCEPTED, attempts, usage, s);
    }

    // A data problem, not a writing problem. Retrying cannot conjure a metric
    // that does not exist in the source, and pressing the model to try invites
    // fabrication. Stop and ask the candidate instead.
    if (s.route === ROUTE.CLARIFY) {
      return finish(OUTCOME.NEEDS_CLARIFICATION, attempts, usage, s);
    }

    // Fabrication is never retried — the model has already shown it will invent
    // to satisfy the rubric, and another attempt just rolls the dice again.
    if (s.reason === REASON.WOULD_REQUIRE_FABRICATION) {
      return finish(OUTCOME.FLAGGED, attempts, usage, s);
    }

    if (s.route === ROUTE.FLAG) {
      return finish(OUTCOME.FLAGGED, attempts, usage, s);
    }
    // else ROUTE.RETRY — loop with a different angle.
  }

  // Retries exhausted. Present the best attempt, honestly labelled.
  return finish(OUTCOME.FLAGGED, attempts, usage, null);
}

function finish(outcome, attempts, usage, lastScore) {
  // On failure, surface the best attempt rather than the last one — the third
  // try is not necessarily better than the first.
  const best = attempts.reduce(
    (acc, a) => (acc === null || a.composite > acc.composite ? a : acc),
    null
  );

  return {
    outcome,
    best,
    attempts,
    usage,
    reason: lastScore?.reason ?? best?.reason ?? REASON.WEAK_PHRASING,
    // Only accepted rewrites are safe to present as improvements.
    accepted: outcome === OUTCOME.ACCEPTED,
    fabricatedClaims: lastScore?.fabricatedClaims ?? [],
  };
}
