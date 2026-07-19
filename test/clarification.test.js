import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isUsableAnswer,
  buildAnswerContext,
  bulletsToRerun,
  mergeIntoSource,
} from '../shared/clarification.js';

test('non-answers are rejected so they never become "source facts"', () => {
  for (const junk of ['', '   ', 'n/a', 'N/A', 'none', 'no', 'idk', "I don't know", 'not sure', 'skip', '-', '--']) {
    assert.equal(isUsableAnswer(junk), false, `"${junk}" should not count as an answer`);
  }
});

test('real answers are accepted, including vague-but-informative ones', () => {
  assert.equal(isUsableAnswer('about a third'), true);
  assert.equal(isUsableAnswer('roughly 20 hours a week'), true);
  assert.equal(isUsableAnswer('4200'), true);
});

test('answer context is empty when nothing usable was provided', () => {
  assert.equal(buildAnswerContext([]), '');
  assert.equal(buildAnswerContext([{ bulletId: 'b1', question: 'How much?', answer: 'n/a' }]), '');
});

test('answer context includes the Q/A and marks it candidate-provided', () => {
  const ctx = buildAnswerContext([
    { bulletId: 'b1', question: 'What changed after it shipped?', answer: 'Tickets dropped about a third' },
  ]);
  assert.match(ctx, /What changed after it shipped\?/);
  assert.match(ctx, /Tickets dropped about a third/);
  assert.match(ctx, /candidate-provided/);
});

test('only bullets with usable answers are re-run', () => {
  const answers = [
    { bulletId: 'b1', question: 'q', answer: 'about 30%' },
    { bulletId: 'b2', question: 'q', answer: 'idk' },
    { bulletId: 'b3', question: 'q', answer: '   ' },
    { bulletId: 'b1', question: 'q2', answer: 'over two quarters' },
  ];
  assert.deepEqual(bulletsToRerun(answers), ['b1']);
});

test('merging preserves an existing experience doc', () => {
  const merged = mergeIntoSource('Original experience notes.', [
    { bulletId: 'b1', question: 'How many?', answer: '4,200 merchants' },
  ]);
  assert.match(merged, /Original experience notes\./);
  assert.match(merged, /4,200 merchants/);
});

test('merging with no usable answers leaves the source untouched', () => {
  const original = 'Original experience notes.';
  assert.equal(mergeIntoSource(original, [{ bulletId: 'b1', question: 'q', answer: 'none' }]), original);
});
