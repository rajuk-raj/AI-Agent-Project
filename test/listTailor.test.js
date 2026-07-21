import test from 'node:test';
import assert from 'node:assert/strict';
import { splitList, joinList, reorderByJd } from '../shared/listTailor.js';
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
