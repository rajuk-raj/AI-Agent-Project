import test from 'node:test';
import assert from 'node:assert/strict';

import { optimizeBullet, OUTCOME } from '../shared/optimizeLoop.js';
import { REASON, ROUTE, MAX_RETRIES_PER_BULLET } from '../shared/scoring.js';

const BULLET = { id: 'b1', text: 'Responsible for the onboarding roadmap' };
const BASE = {
  bullet: BULLET,
  targetCompetency: 'EXECUTION',
  resumeText: 'Responsible for the onboarding roadmap',
};

const meta = { usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 } };

/** Stub rewriter that records how it was called. */
function stubRewrite(calls) {
  return async (args) => {
    calls.push(args);
    return {
      rewrite: `rewrite-attempt-${args.attempt}`,
      claimsUsed: [],
      rationale: 'stub',
      meta,
    };
  };
}

/** Stub scorer driven by a scripted list of outcomes. */
function stubScore(script) {
  let i = 0;
  return async () => {
    const s = script[Math.min(i++, script.length - 1)];
    return {
      composite: s.composite,
      reason: s.reason,
      route: s.route,
      scores: { competency: 0, star: 0, specificity: 0, format: 0 },
      format: { issues: [] },
      fabricationRisk: s.reason === REASON.WOULD_REQUIRE_FABRICATION,
      fabricatedClaims: s.fabricatedClaims ?? [],
      sourceHasMetric: true,
      rationale: 'stub',
      meta,
    };
  };
}

test('accepts on the first pass and makes exactly one rewrite call', async () => {
  const calls = [];
  const res = await optimizeBullet(BASE, {
    rewriteFn: stubRewrite(calls),
    scoreFn: stubScore([{ composite: 82, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT }]),
  });

  assert.equal(res.outcome, OUTCOME.ACCEPTED);
  assert.equal(res.accepted, true);
  assert.equal(calls.length, 1);
  assert.equal(res.usage.calls, 2); // one rewrite + one score
});

test('retries on weak phrasing, then accepts', async () => {
  const calls = [];
  const res = await optimizeBullet(BASE, {
    rewriteFn: stubRewrite(calls),
    scoreFn: stubScore([
      { composite: 54, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
      { composite: 76, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT },
    ]),
  });

  assert.equal(res.outcome, OUTCOME.ACCEPTED);
  assert.equal(calls.length, 2);
  assert.equal(res.best.composite, 76);
});

test('a retry is told what already failed, so it can change angle', async () => {
  const calls = [];
  await optimizeBullet(BASE, {
    rewriteFn: stubRewrite(calls),
    scoreFn: stubScore([
      { composite: 40, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
      { composite: 90, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT },
    ]),
  });

  assert.deepEqual(calls[0].previousAttempts, []);
  assert.deepEqual(calls[1].previousAttempts, ['rewrite-attempt-0']);
  assert.equal(calls[1].attempt, 1);
});

test('missing source data stops immediately — no retries burned', async () => {
  const calls = [];
  const res = await optimizeBullet(BASE, {
    rewriteFn: stubRewrite(calls),
    scoreFn: stubScore([
      { composite: 48, reason: REASON.NO_QUANTIFIABLE_DATA, route: ROUTE.CLARIFY },
    ]),
  });

  assert.equal(res.outcome, OUTCOME.NEEDS_CLARIFICATION);
  assert.equal(calls.length, 1, 'must not retry a bullet whose data does not exist');
  assert.equal(res.accepted, false);
});

test('fabrication is flagged immediately and never retried', async () => {
  const calls = [];
  const res = await optimizeBullet(BASE, {
    rewriteFn: stubRewrite(calls),
    scoreFn: stubScore([
      {
        composite: 91,
        reason: REASON.WOULD_REQUIRE_FABRICATION,
        route: ROUTE.FLAG,
        fabricatedClaims: ['reduced churn by 40%'],
      },
    ]),
  });

  assert.equal(res.outcome, OUTCOME.FLAGGED);
  assert.equal(res.accepted, false, 'a fabricated rewrite must never be presented as accepted');
  assert.equal(calls.length, 1);
  assert.deepEqual(res.fabricatedClaims, ['reduced churn by 40%']);
});

test('retries are capped and the BEST attempt is surfaced, not the last', async () => {
  const calls = [];
  const res = await optimizeBullet(BASE, {
    rewriteFn: stubRewrite(calls),
    scoreFn: stubScore([
      { composite: 45, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
      { composite: 68, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY }, // best
      { composite: 51, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
      { composite: 49, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
    ]),
  });

  assert.equal(res.outcome, OUTCOME.FLAGGED);
  assert.equal(res.accepted, false);
  assert.equal(calls.length, MAX_RETRIES_PER_BULLET + 1);
  assert.equal(res.best.composite, 68, 'should surface the best attempt, not the final one');
});

test('usage accumulates across every attempt', async () => {
  const res = await optimizeBullet(BASE, {
    rewriteFn: stubRewrite([]),
    scoreFn: stubScore([
      { composite: 45, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
      { composite: 80, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT },
    ]),
  });

  // 2 attempts x (rewrite + score) = 4 calls x 10 input tokens
  assert.equal(res.usage.calls, 4);
  assert.equal(res.usage.inputTokens, 40);
});

test('progress is reported for every attempt', async () => {
  const log = [];
  await optimizeBullet(BASE, {
    rewriteFn: stubRewrite([]),
    scoreFn: stubScore([
      { composite: 45, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
      { composite: 80, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT },
    ]),
    onProgress: (line) => log.push(line),
  });

  assert.equal(log.length, 2);
  assert.match(log[0], /b1 attempt 1: 45%/);
  assert.match(log[1], /b1 attempt 2: 80%/);
});
