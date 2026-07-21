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

/* ------------------------------------------------------------------ *
 * Chasing the JD match — v1.5
 *
 * The loop keeps going past an accept when the rewrite is accurate but
 * distant from the posting. The rule these tests pin down is that the
 * chase can never cost accuracy: a higher JD match is only ever allowed
 * to pick between rewrites the scorer already accepted.
 * ------------------------------------------------------------------ */

/** Stub matcher: reads the percentage out of the stubbed rewrite text. */
const stubMatch = (byAttempt) => (text) => {
  const n = Number(text.match(/attempt-(\d+)/)?.[1] ?? 0);
  return { percent: byAttempt[Math.min(n, byAttempt.length - 1)], best: { text: 'req', hits: [] } };
};
const stubFeedback = () => ({ requirement: 'req', missing: ['payments'], percent: 40 });

test('an accepted rewrite below the JD target is retried, not returned', async () => {
  const calls = [];
  const res = await optimizeBullet(
    { ...BASE, jdTarget: 90 },
    {
      rewriteFn: stubRewrite(calls),
      scoreFn: stubScore([{ composite: 80, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT }]),
      jdMatchFn: stubMatch([50, 95]),
      jdFeedbackFn: stubFeedback,
    }
  );

  assert.equal(res.outcome, OUTCOME.ACCEPTED);
  assert.equal(calls.length, 2, 'should have tried again for a closer JD fit');
  assert.equal(res.best.jdMatch.percent, 95);
  // The retry must carry the posting's unused words, or it is just a resample.
  assert.deepEqual(calls[1].jdFocus.missing, ['payments']);
});

test('an accepted rewrite at or above the target returns immediately', async () => {
  const calls = [];
  const res = await optimizeBullet(
    { ...BASE, jdTarget: 90 },
    {
      rewriteFn: stubRewrite(calls),
      scoreFn: stubScore([{ composite: 80, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT }]),
      jdMatchFn: stubMatch([92]),
      jdFeedbackFn: stubFeedback,
    }
  );

  assert.equal(calls.length, 1, 'no reason to spend another call');
  assert.equal(res.best.jdMatch.percent, 92);
});

test('a higher JD match never promotes a rewrite the scorer rejected', async () => {
  const res = await optimizeBullet(
    { ...BASE, jdTarget: 90 },
    {
      rewriteFn: stubRewrite([]),
      // First attempt accepted; the chase then produces a keyword-stuffed
      // draft that scores higher on JD fit but fails the accuracy bar.
      scoreFn: stubScore([
        { composite: 80, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT },
        { composite: 40, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
        { composite: 40, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
        { composite: 40, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY },
      ]),
      jdMatchFn: stubMatch([55, 99, 99, 99]),
      jdFeedbackFn: stubFeedback,
    }
  );

  assert.equal(res.outcome, OUTCOME.ACCEPTED);
  assert.equal(res.best.jdMatch.percent, 55, 'must keep the accurate one');
  assert.equal(res.best.accepted, true);
});

test('a banked accept survives a later attempt that needs clarification', async () => {
  const res = await optimizeBullet(
    { ...BASE, jdTarget: 90 },
    {
      rewriteFn: stubRewrite([]),
      scoreFn: stubScore([
        { composite: 78, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT },
        { composite: 50, reason: REASON.NO_QUANTIFIABLE_DATA, route: ROUTE.CLARIFY },
      ]),
      jdMatchFn: stubMatch([60, 99]),
      jdFeedbackFn: stubFeedback,
    }
  );

  assert.equal(res.outcome, OUTCOME.ACCEPTED, 'a good rewrite must not be thrown away');
  assert.equal(res.best.jdMatch.percent, 60);
});

test('an unreachable target gives up after the retry cap, keeping the best honest fit', async () => {
  const calls = [];
  const res = await optimizeBullet(
    { ...BASE, jdTarget: 90 },
    {
      rewriteFn: stubRewrite(calls),
      scoreFn: stubScore([{ composite: 80, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT }]),
      jdMatchFn: stubMatch([40, 45, 50, 55]),
      jdFeedbackFn: stubFeedback,
    }
  );

  assert.equal(res.outcome, OUTCOME.ACCEPTED);
  assert.equal(calls.length, MAX_RETRIES_PER_BULLET + 1, 'capped, not infinite');
  assert.equal(res.best.jdMatch.percent, 55, 'the closest it honestly got');
});

test('without a JD the loop is unchanged — one accept, one call', async () => {
  const calls = [];
  const res = await optimizeBullet(BASE, {
    rewriteFn: stubRewrite(calls),
    scoreFn: stubScore([{ composite: 82, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT }]),
  });

  assert.equal(res.outcome, OUTCOME.ACCEPTED);
  assert.equal(calls.length, 1);
  assert.equal(res.best.jdMatch, null);
});

test('a rewrite that keeps a real result outranks a better-matching one that drops it', async () => {
  let n = 0;
  const rewriteFn = async (args) => {
    // Attempt 0 states the outcome; the JD-chasing retry trades it for the
    // posting's vocabulary. This is the regression seen on a live run.
    const hasResult = n++ === 0;
    return {
      rewrite: `rewrite-attempt-${args.attempt}`,
      claimsUsed: [],
      rationale: 'stub',
      star: {
        situationTask: 's',
        action: 'a',
        result: hasResult ? 'drop-off from 41% to 23%' : null,
      },
      meta,
    };
  };

  const res = await optimizeBullet(
    { ...BASE, jdTarget: 90 },
    {
      rewriteFn,
      scoreFn: stubScore([{ composite: 80, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT }]),
      jdMatchFn: stubMatch([50, 88]),
      jdFeedbackFn: stubFeedback,
    }
  );

  assert.equal(res.best.star.result, 'drop-off from 41% to 23%');
  assert.equal(res.best.jdMatch.percent, 50, 'the lower JD match is the better bullet');
});

test('the chase stops as soon as it stops paying off', async () => {
  const calls = [];
  const res = await optimizeBullet(
    { ...BASE, jdTarget: 90 },
    {
      rewriteFn: stubRewrite(calls),
      scoreFn: stubScore([{ composite: 80, reason: REASON.ACCEPTED, route: ROUTE.ACCEPT }]),
      // Drifting away from the posting, as happens on a poorly-overlapping JD.
      jdMatchFn: stubMatch([25, 13, 13, 13]),
      jdFeedbackFn: stubFeedback,
    }
  );

  assert.equal(calls.length, 2, 'one chase attempt, then stop — not four');
  assert.equal(res.best.jdMatch.percent, 25, 'keeps the closest version');
});

test('the reported objection belongs to the draft being surfaced', async () => {
  let n = 0;
  const rewriteFn = async (args) => ({
    rewrite: `rewrite-attempt-${args.attempt}`,
    claimsUsed: [],
    rationale: 'stub',
    star: { situationTask: 's', action: 'a', result: 'r' },
    meta,
  });

  const res = await optimizeBullet(BASE, {
    rewriteFn,
    // Attempt 1 is merely weak; attempt 2 invents something. The best attempt
    // by score is the clean one, so its objection is the one to report.
    scoreFn: async () => {
      const s =
        n++ === 0
          ? { composite: 65, reason: REASON.WEAK_PHRASING, route: ROUTE.RETRY, fabricatedClaims: [] }
          : {
              composite: 20,
              reason: REASON.WOULD_REQUIRE_FABRICATION,
              route: ROUTE.FLAG,
              fabricatedClaims: ['enhancing efficiency significantly'],
            };
      return {
        composite: s.composite,
        reason: s.reason,
        route: s.route,
        scores: { competency: 0, star: 0, specificity: 0, format: 0 },
        format: { issues: [] },
        fabricationRisk: s.reason === REASON.WOULD_REQUIRE_FABRICATION,
        fabricatedClaims: s.fabricatedClaims,
        sourceHasMetric: true,
        rationale: 'stub',
        meta,
      };
    },
  });

  assert.equal(res.best.composite, 65, 'the clean attempt is the best one');
  assert.deepEqual(
    res.fabricatedClaims,
    [],
    'a clean draft must not carry another attempt’s fabrication warning'
  );
});
