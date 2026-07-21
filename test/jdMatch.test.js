import test from 'node:test';
import assert from 'node:assert/strict';
import { terms, indexJd, matchBullet, coverJd } from '../shared/jdMatch.js';

const JD = {
  title: 'Senior Product Manager, Payments',
  requirements: [
    'Experience running merchant discovery and translating research into roadmap decisions',
    'Track record of driving checkout conversion through experimentation',
    'Comfortable with SQL and building dashboards',
  ],
  responsibilities: ['Own the disputes and chargeback experience end to end'],
  keywords: ['checkout conversion', 'merchant', 'SQL', 'disputes'],
};

test('terms drops stopwords and stems to a common root', () => {
  const t = terms('Driving prioritisation of merchant experiments');
  assert.ok(t.has('merchant'));
  assert.ok(!t.has('of'));
  // "prioritisation" and "prioritise" must land on the same stem.
  assert.deepEqual([...terms('prioritisation')], [...terms('prioritise')]);
});

test('a bullet answering a requirement scores far above an unrelated one', () => {
  const idx = indexJd(JD);
  const onTarget = matchBullet(
    'Ran 18 merchant discovery interviews and translated the research into three roadmap decisions',
    idx
  );
  const offTarget = matchBullet('Organised the office summer party for 200 people', idx);

  assert.ok(onTarget.percent > 50, `expected >50, got ${onTarget.percent}`);
  assert.ok(offTarget.percent < 20, `expected <20, got ${offTarget.percent}`);
  assert.match(onTarget.best.text, /merchant discovery/);
});

test('the matched requirement and its hit words are reported, so the number is explainable', () => {
  const idx = indexJd(JD);
  const m = matchBullet('Cut checkout conversion drop-off through weekly experimentation', idx);
  assert.match(m.best.text, /checkout conversion/);
  assert.ok(m.best.hits.includes('checkout'));
  assert.ok(m.best.hits.includes('convers'));
});

test('a keyword counts only when all of its words are present', () => {
  const idx = indexJd(JD);
  const partial = matchBullet('Improved conversion on the pricing page', idx);
  assert.ok(!partial.keywordHits.includes('checkout conversion'));

  const full = matchBullet('Improved checkout conversion on mobile', idx);
  assert.ok(full.keywordHits.includes('checkout conversion'));
});

test('no JD means no percentage — not a zero', () => {
  assert.equal(matchBullet('Any bullet at all', null), null);
  assert.equal(indexJd(null), null);
  assert.equal(indexJd({ requirements: [], responsibilities: [], keywords: [] }), null);
});

test('an empty bullet scores nothing rather than throwing', () => {
  assert.equal(matchBullet('', indexJd(JD)), null);
});

test('scores are stable across repeated calls', () => {
  const idx = indexJd(JD);
  const bullet = 'Owned the disputes experience and cut resolution time from 9 days to 4';
  assert.equal(matchBullet(bullet, idx).percent, matchBullet(bullet, idx).percent);
});

test('a short requirement cannot be fully covered by one incidental word', () => {
  const idx = indexJd({ requirements: ['SQL'], responsibilities: [], keywords: [] });
  const m = matchBullet('Wrote SQL queries against the warehouse', idx);
  // One hit against a floored denominator of 3 — not a free 100%.
  assert.ok(m.percent <= 40, `expected <=40, got ${m.percent}`);
});

test('coverage counts requirements answered across a whole section', () => {
  const idx = indexJd(JD);
  const cov = coverJd(
    [
      'Ran merchant discovery interviews that redirected the roadmap',
      'Owned disputes and chargeback experience end to end',
    ],
    idx
  );
  assert.equal(cov.total, 4);
  assert.ok(cov.answered >= 2, `expected >=2 answered, got ${cov.answered}`);
  assert.equal(cov.unanswered.length, cov.total - cov.answered);
});

test('coverage reports nothing when there is no JD to cover', () => {
  assert.equal(coverJd(['anything'], null), null);
});
