import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkFormat,
  escapeLatex,
  detectMetrics,
  computeComposite,
  deriveOutcome,
  WEIGHTS,
  REASON,
  ROUTE,
  THRESHOLD,
  MAX_BULLET_CHARS,
} from '../shared/scoring.js';

import {
  computeCoverage,
  COMPETENCY_IDS,
  STRENGTH,
} from '../shared/competencyModel.js';

// A realistic strong bullet: action verb, quantified result, under the cap.
const GOOD = 'Cut payment failure rate 34% by re-sequencing the retry roadmap with eng';

test('weights sum to exactly 1', () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum * 1000) / 1000, 1);
});

test('checkFormat passes a well-formed quantified bullet', () => {
  const r = checkFormat(GOOD);
  assert.deepEqual(r.issues, [], `unexpected issues: ${r.issues.join(' | ')}`);
  assert.equal(r.pass, true);
  assert.equal(r.score, 100);
});

test('a percentage does not cost format points — it is escaped on export', () => {
  const r = checkFormat(GOOD);
  assert.equal(r.score, 100, 'quantified bullets must not be penalized for "%"');
  assert.equal(r.needsLatexEscaping, true, 'but export must still know to escape it');
});

test('needsLatexEscaping is stable across repeated calls', () => {
  // Guards against a stateful /g regex lastIndex bug.
  const a = checkFormat(GOOD).needsLatexEscaping;
  const b = checkFormat(GOOD).needsLatexEscaping;
  const c = checkFormat(GOOD).needsLatexEscaping;
  assert.deepEqual([a, b, c], [true, true, true]);
});

test('stray braces and backslashes still count as malformed text', () => {
  const r = checkFormat('Shipped the {retry} flow \\ cut failures 12%');
  assert.equal(r.pass, false);
  assert.match(r.issues.join(' '), /malformed/);
});

test('escapeLatex escapes prose characters for a template', () => {
  assert.equal(escapeLatex('Cut cost 34% & saved $2M'), 'Cut cost 34\\% \\& saved \\$2M');
  assert.equal(escapeLatex('a_b'), 'a\\_b');
});

test('checkFormat flags an over-length bullet', () => {
  const r = checkFormat('Shipped ' + 'x'.repeat(MAX_BULLET_CHARS));
  assert.equal(r.pass, false);
  assert.match(r.issues.join(' '), /over the 150 limit/);
});

test('checkFormat flags a line break', () => {
  const r = checkFormat('Shipped the retry flow\nand cut failures 12%');
  assert.match(r.issues.join(' '), /single line/);
});

test('checkFormat flags a weak opener by name', () => {
  const r = checkFormat('Responsible for the payments roadmap and vendor relationships');
  assert.equal(r.pass, false);
  assert.match(r.issues.join(' '), /Responsible for|responsible for/);
});

test('checkFormat flags a non-action opener', () => {
  const r = checkFormat('Various improvements to the onboarding funnel over two quarters');
  assert.equal(r.pass, false);
  assert.match(r.issues.join(' '), /action verb/);
});

test('checkFormat treats an empty bullet as a total failure', () => {
  const r = checkFormat('   ');
  assert.equal(r.score, 0);
  assert.equal(r.pass, false);
});

test('detectMetrics finds each supported metric shape', () => {
  assert.equal(detectMetrics('Cut churn 34%').hasMetric, true);
  assert.equal(detectMetrics('Drove $2.4M in new ARR').hasMetric, true);
  assert.equal(detectMetrics('Grew throughput 3x').hasMetric, true);
  assert.equal(detectMetrics('Onboarded 12,000 merchants').hasMetric, true);
  assert.equal(detectMetrics('Improved the onboarding flow').hasMetric, false);
});

test('computeComposite applies the documented weights', () => {
  assert.equal(computeComposite({ competency: 100, star: 100, specificity: 100, format: 100 }), 100);
  assert.equal(computeComposite({ competency: 0, star: 0, specificity: 0, format: 0 }), 0);
  // 80*.30 + 60*.30 + 40*.25 + 100*.15 = 24 + 18 + 10 + 15 = 67
  assert.equal(computeComposite({ competency: 80, star: 60, specificity: 40, format: 100 }), 67);
});

test('computeComposite rejects a missing criterion rather than scoring NaN', () => {
  assert.throws(
    () => computeComposite({ competency: 80, star: 60, specificity: 40 }),
    /format/
  );
});

test('fabrication risk short-circuits regardless of score', () => {
  const out = deriveOutcome({
    scores: { competency: 100, star: 100, specificity: 100 },
    format: checkFormat(GOOD),
    rewrite: GOOD,
    fabricationRisk: true,
  });
  assert.equal(out.reason, REASON.WOULD_REQUIRE_FABRICATION);
  assert.equal(out.route, ROUTE.FLAG);
});

test('a bullet at or above threshold is accepted', () => {
  const out = deriveOutcome({
    scores: { competency: 85, star: 80, specificity: 75 },
    format: checkFormat(GOOD),
    rewrite: GOOD,
  });
  assert.ok(out.composite >= THRESHOLD);
  assert.equal(out.route, ROUTE.ACCEPT);
});

test('missing source data routes to clarification, not retry', () => {
  const vague = 'Improved the onboarding flow for new merchants';
  const out = deriveOutcome({
    scores: { competency: 70, star: 60, specificity: 20 },
    format: checkFormat(vague),
    rewrite: vague,
    sourceHasMetric: false,
  });
  assert.equal(out.reason, REASON.NO_QUANTIFIABLE_DATA);
  assert.equal(out.route, ROUTE.CLARIFY);
});

test('weak writing with data available is retried, not sent to clarification', () => {
  const wordy = 'Responsible for a project that reduced churn by 22% across the merchant base';
  const out = deriveOutcome({
    scores: { competency: 70, star: 55, specificity: 80 },
    format: checkFormat(wordy),
    rewrite: wordy,
    sourceHasMetric: true,
  });
  assert.equal(out.route, ROUTE.RETRY);
  assert.notEqual(out.reason, REASON.NO_QUANTIFIABLE_DATA);
});

test('retries are capped — an exhausted bullet is flagged', () => {
  const wordy = 'Responsible for a project that reduced churn by 22% across the merchant base';
  const out = deriveOutcome({
    scores: { competency: 70, star: 55, specificity: 80 },
    format: checkFormat(wordy),
    rewrite: wordy,
    sourceHasMetric: true,
    attempt: 3,
  });
  assert.equal(out.route, ROUTE.FLAG);
});

test('coverage counts only strong bullets and reports gaps', () => {
  const bullets = [
    { competency: 'EXECUTION', strength: STRENGTH.STRONG },
    { competency: 'EXECUTION', strength: STRENGTH.STRONG },
    { competency: 'METRICS', strength: STRENGTH.WEAK },
    { competency: 'INFLUENCE', strength: STRENGTH.STRONG },
    { competency: 'NONE', strength: STRENGTH.NONE },
  ];
  const cov = computeCoverage(bullets, 'PM');

  assert.equal(cov.display, `2/${COMPETENCY_IDS.length}`);
  assert.deepEqual(cov.coveredIds.sort(), ['EXECUTION', 'INFLUENCE']);
  // METRICS has only a weak bullet, so it is still a gap.
  assert.ok(cov.gapIds.includes('METRICS'));
  assert.ok(cov.gapIds.includes('DISCOVERY'));
  assert.equal(cov.byCompetency.EXECUTION.strong, 2);
});

test('seniority changes which competencies count as gaps', () => {
  const bullets = [{ competency: 'EXECUTION', strength: STRENGTH.STRONG }];
  const apm = computeCoverage(bullets, 'APM');
  const director = computeCoverage(bullets, 'DIRECTOR');
  assert.ok(
    director.gapIds.length > apm.gapIds.length,
    'a Director resume should be held to more competencies than an APM one'
  );
});
