import test from 'node:test';
import assert from 'node:assert/strict';
import { splitList, joinList, reorderByJd, matchListToJd } from '../shared/listTailor.js';
import { indexJd } from '../shared/jdMatch.js';

const JD = {
  requirements: ['Strong command over product analytics and experimentation', 'Comfortable writing SQL'],
  responsibilities: ['Build roadmaps in Jira with engineering'],
  keywords: ['SQL', 'Jira', 'Mixpanel'],
};

test('splits a labelled list and keeps the label separate', () => {
  const { label, items } = splitList('Technical Skills: SQL, Python, Linux, Advanced Excel');
  assert.equal(label, 'Technical Skills');
  assert.deepEqual(items, ['SQL', 'Python', 'Linux', 'Advanced Excel']);
});

test('splits an unlabelled list', () => {
  const { label, items } = splitList('Figma, Whimsical · Notion');
  assert.equal(label, null);
  assert.deepEqual(items, ['Figma', 'Whimsical', 'Notion']);
});

test('a label round-trips exactly as written', () => {
  const { label, items } = splitList('Tools: Figma, Notion, JIRA');
  assert.equal(joinList(label, items), 'Tools: Figma, Notion, JIRA');
});

test('items the posting asks for move to the front', () => {
  const res = reorderByJd('Technical Skills: Python, Linux, SQL, MS Office', indexJd(JD));
  assert.equal(res.items[0], 'SQL');
  assert.ok(res.matched.includes('SQL'));
  assert.equal(res.changed, true);
});

test('reordering never adds, drops, or edits an item', () => {
  const original = 'Tools: Figma, Whimsical, Balsamiq, Notion, JIRA, Mixpanel';
  const res = reorderByJd(original, indexJd(JD));
  assert.deepEqual([...res.items].sort(), [...splitList(original).items].sort());
  assert.equal(res.text.startsWith('Tools: '), true);
});

test('unmatched items keep their original relative order', () => {
  const res = reorderByJd('Tools: Figma, Whimsical, Balsamiq, JIRA', indexJd(JD));
  const tail = res.items.filter((i) => i !== 'JIRA');
  assert.deepEqual(tail, ['Figma', 'Whimsical', 'Balsamiq']);
});

test('a list with nothing the posting wants comes back unchanged', () => {
  const res = reorderByJd('Interests: Cricket, Cooking, Chess', indexJd(JD));
  assert.equal(res.changed, false);
  assert.deepEqual(res.items, ['Cricket', 'Cooking', 'Chess']);
});

test('no JD, or a single-item list, means no reordering to offer', () => {
  assert.equal(reorderByJd('Tools: Figma, Notion', null), null);
  assert.equal(reorderByJd('Tools: Figma', indexJd(JD)), null);
});

test('a partial term match does not count as a hit', () => {
  // "Advanced Excel" must not match on "advanced" alone.
  const res = reorderByJd('Skills: Advanced Excel, SQL', indexJd(JD));
  assert.deepEqual(res.matched, ['SQL']);
});

test('a roster is scored by how many things the posting names it has', () => {
  const res = matchListToJd('Tools: Figma, Notion, JIRA, Mixpanel', indexJd(JD));
  // JD keywords: SQL, Jira, Mixpanel -> has 2 of 3.
  assert.deepEqual(res.have.sort(), ['Jira', 'Mixpanel']);
  assert.deepEqual(res.missing, ['SQL']);
  assert.equal(res.percent, 67);
});

test('matching a named thing works in both directions', () => {
  const idx = indexJd({ requirements: [], responsibilities: [], keywords: ['Excel'] });
  // "Advanced Excel" on the resume answers a posting asking for "Excel".
  assert.equal(matchListToJd('Skills: Advanced Excel', idx).have.length, 1);

  const idx2 = indexJd({ requirements: [], responsibilities: [], keywords: ['Advanced Excel'] });
  assert.equal(matchListToJd('Skills: Excel', idx2).have.length, 1);
});

test('a near-miss on one shared word is not a match', () => {
  const idx = indexJd({ requirements: [], responsibilities: [], keywords: ['advanced analytics'] });
  assert.deepEqual(matchListToJd('Skills: Advanced Excel', idx).have, []);
});

test('a posting with no vocabulary of its own yields no list score', () => {
  const idx = indexJd({ requirements: ['Be great'], responsibilities: [], keywords: [] });
  assert.equal(matchListToJd('Tools: Figma', idx), null);
  assert.equal(matchListToJd('Tools: Figma', null), null);
});

test('prose keywords are excluded from a roster denominator', () => {
  // A tools list cannot contain "merchant activation" — counting it would
  // score a complete list as a weak one.
  const idx = indexJd({
    requirements: [],
    responsibilities: [],
    keywords: [
      'merchant activation',
      'signup funnel',
      'analyse results',
      'engineering',
      'design',
      'product delivery',
      'Figma',
      'JIRA',
      'Mixpanel',
    ],
  });

  const res = matchListToJd('Tools: Figma, JIRA, Mixpanel, Notion', idx);
  assert.equal(res.percent, 100, 'has every tool the posting names');
  assert.deepEqual(res.missing, []);
});

test('a Title Cased posting falls back to the full keyword set', () => {
  // Everything looks like a proper noun, so capitalisation carries no signal.
  const idx = indexJd({
    requirements: [],
    responsibilities: [],
    keywords: ['Merchant Activation', 'Signup Funnel', 'Figma'],
  });

  const res = matchListToJd('Tools: Figma', idx);
  assert.equal(res.have.length + res.missing.length, 3);
});
