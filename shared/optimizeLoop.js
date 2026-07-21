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
 * @param {number} [input.jdTarget]         JD match to aim for, 0-100.
 * @param {object} deps
 * @param {Function} deps.rewriteFn
 * @param {Function} deps.scoreFn
 * @param {Function} [deps.jdMatchFn]       text -> { percent, ... } | null. Pure and free.
 * @param {Function} [deps.jdFeedbackFn]    text -> { requirement, missing[] } | null.
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
    jdTarget = 0,
  },
  { rewriteFn, scoreFn, jdMatchFn = null, jdFeedbackFn = null, onProgress = () => {} }
) {
  const attempts = [];
  const usage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, calls: 0 };

  const addUsage = (meta) => {
    usage.inputTokens += meta.usage.inputTokens;
    usage.outputTokens += meta.usage.outputTokens;
    usage.thinkingTokens += meta.usage.thinkingTokens;
    usage.calls += 1;
  };

  // Carries the posting's unused vocabulary into the next attempt. Set only
  // when a rewrite was good enough to accept but landed short of the JD
  // target — chasing the target on a draft that isn't yet accurate would
  // optimise the wrong thing first.
  let jdFocus = null;

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
      jdFocus,
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

    // Free and deterministic, so it costs nothing to measure every attempt.
    const jdMatch = jdMatchFn ? jdMatchFn(r.rewrite) : null;

    attempts.push({
      attempt,
      rewrite: r.rewrite,
      rationale: r.rationale,
      claimsUsed: r.claimsUsed,
      star: r.star ?? null,
      composite: s.composite,
      scores: s.scores,
      reason: s.reason,
      fabricatedClaims: s.fabricatedClaims,
      formatIssues: s.format.issues,
      accepted: s.route === ROUTE.ACCEPT,
      jdMatch,
    });

    onProgress(
      `${bullet.id} attempt ${attempt + 1}: ${s.composite}%` +
        (jdMatch ? `, JD ${jdMatch.percent}%` : '') +
        ` (${s.reason})`
    );

    if (s.route === ROUTE.ACCEPT) {
      const shortOfTarget = jdMatch && jdTarget > 0 && jdMatch.percent < jdTarget;
      const attemptsLeft = attempt < MAX_RETRIES_PER_BULLET;

      // Accurate but not yet as close to the posting as it could be. Try
      // again with the posting's unused vocabulary in view — but keep this
      // attempt, because a later one is only used if it also passes the
      // accuracy bar. Chasing the target can never trade away correctness.
      // Stop chasing the moment a chase stops paying. Measured on a live run:
      // against a posting with little overlap, successive attempts drifted
      // further from the JD (25% -> 13%) while burning two calls each. If this
      // attempt didn't beat the best so far, more attempts won't either.
      const bestSoFar = Math.max(
        ...attempts.slice(0, -1).map((a) => a.jdMatch?.percent ?? -1),
        -1
      );
      const chaseIsWorking = jdMatch && jdMatch.percent > bestSoFar;

      if (shortOfTarget && attemptsLeft && jdFeedbackFn && chaseIsWorking) {
        jdFocus = jdFeedbackFn(r.rewrite);
        continue;
      }

      return finish(OUTCOME.ACCEPTED, attempts, usage, s);
    }

    // An earlier attempt already cleared the bar. A later one failing is just
    // a worse draft, not a reason to throw away a good rewrite — this is only
    // reachable because chasing the JD target keeps looping past an accept.
    const banked = attempts.some((a) => a.accepted);

    // A data problem, not a writing problem. Retrying cannot conjure a metric
    // that does not exist in the source, and pressing the model to try invites
    // fabrication. Stop and ask the candidate instead.
    if (s.route === ROUTE.CLARIFY) {
      return banked
        ? finish(OUTCOME.ACCEPTED, attempts, usage, null)
        : finish(OUTCOME.NEEDS_CLARIFICATION, attempts, usage, s);
    }

    // Fabrication is never retried — the model has already shown it will invent
    // to satisfy the rubric, and another attempt just rolls the dice again.
    if (s.reason === REASON.WOULD_REQUIRE_FABRICATION) {
      return finish(OUTCOME.FLAGGED, attempts, usage, s);
    }

    if (s.route === ROUTE.FLAG) {
      return banked
        ? finish(OUTCOME.ACCEPTED, attempts, usage, null)
        : finish(OUTCOME.FLAGGED, attempts, usage, s);
    }
    // else ROUTE.RETRY — loop with a different angle.
  }

  // Retries exhausted. If anything cleared the bar along the way, that stands;
  // otherwise present the best attempt, honestly labelled.
  return finish(
    attempts.some((a) => a.accepted) ? OUTCOME.ACCEPTED : OUTCOME.FLAGGED,
    attempts,
    usage,
    null
  );
}

function finish(outcome, attempts, usage, lastScore) {
  // On failure, surface the best attempt rather than the last one — the third
  // try is not necessarily better than the first.
  //
  // Accuracy first: only attempts that cleared the accuracy bar are eligible
  // when any did, so a higher JD match can never promote a rewrite the scorer
  // rejected. Within those, prefer the closest fit to the posting.
  const eligible = attempts.filter((a) => a.accepted);
  let pool = eligible.length ? eligible : attempts;

  // A rewrite that states an outcome always beats one that doesn't. Measured
  // on a live run: chasing the posting's vocabulary produced a version that
  // traded a real "drop-off from 41% to 23%" for the phrase "to enhance
  // onboarding efficiency" — better JD wording, strictly worse bullet. Losing
  // a result the source actually contains is never an improvement.
  const withResult = pool.filter((a) => a.star?.result);
  if (withResult.length) pool = withResult;

  const best = pool.reduce((acc, a) => {
    if (acc === null) return a;
    const byJd = (a.jdMatch?.percent ?? -1) - (acc.jdMatch?.percent ?? -1);
    if (byJd !== 0) return byJd > 0 ? a : acc;
    return a.composite > acc.composite ? a : acc;
  }, null);

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
