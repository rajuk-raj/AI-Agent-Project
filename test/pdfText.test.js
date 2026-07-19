import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { itemsToLines, cleanResumeText } from '../shared/pdfText.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PDF = path.join(ROOT, 'test/fixtures/sample-resume.pdf');

/* ---------------- unit: line reconstruction ---------------- */

// pdf.js item shape: transform is [a,b,c,d,x,y]
const item = (str, x, y, width = str.length * 5, height = 10) => ({
  str,
  transform: [height, 0, 0, height, x, y],
  width,
  height,
});

test('fragments on the same baseline join into one line', () => {
  const lines = itemsToLines([
    item('Cut merchant onboarding', 68, 500),
    item('drop-off from 41% to 23%', 190, 500),
  ]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Cut merchant onboarding drop-off from 41% to 23%/);
});

test('different baselines stay on separate lines', () => {
  const lines = itemsToLines([
    item('Responsible for the roadmap', 68, 500),
    item('Cut drop-off from 41% to 23%', 68, 487),
  ]);
  assert.equal(lines.length, 2, 'bullets must not collapse into one line');
});

test('sub-pixel baseline drift is treated as the same line', () => {
  // Real PDFs routinely emit same-line runs a fraction of a point apart.
  const lines = itemsToLines([
    item('Launched a dashboard', 68, 500),
    item('used by 4,200 merchants', 190, 498.7),
  ]);
  assert.equal(lines.length, 1);
});

test('lines come back top-to-bottom regardless of emission order', () => {
  const lines = itemsToLines([
    item('third', 68, 470),
    item('first', 68, 500),
    item('second', 68, 485),
  ]);
  assert.deepEqual(lines, ['first', 'second', 'third']);
});

test('a word split across fragments is not broken by a spurious space', () => {
  // "Prod" + "uct" with no gap must not become "Prod uct".
  const lines = itemsToLines([
    { str: 'Prod', transform: [10, 0, 0, 10, 68, 500], width: 20, height: 10 },
    { str: 'uct', transform: [10, 0, 0, 10, 88, 500], width: 15, height: 10 },
  ]);
  assert.equal(lines[0], 'Product');
});

test('a real horizontal gap does produce a space', () => {
  const lines = itemsToLines([
    { str: 'Mar 2023', transform: [10, 0, 0, 10, 54, 500], width: 40, height: 10 },
    { str: '- Present', transform: [10, 0, 0, 10, 110, 500], width: 40, height: 10 },
  ]);
  assert.equal(lines[0], 'Mar 2023 - Present');
});

test('empty and whitespace-only fragments are dropped', () => {
  assert.deepEqual(itemsToLines([item('  ', 68, 500), item('', 80, 500)]), []);
  assert.deepEqual(itemsToLines([]), []);
});

/* ---------------- unit: cleaning ---------------- */

test('bullet glyphs normalise to "- "', () => {
  assert.equal(cleanResumeText('• Shipped it'), '- Shipped it');
  assert.equal(cleanResumeText('▪ Shipped it'), '- Shipped it');
});

test('smart quotes and non-breaking spaces are normalised', () => {
  assert.equal(cleanResumeText('the team’s goal'), "the team's goal");
});

/* ---------------- integration: a real PDF ---------------- */

test('extracts every bullet from a real generated PDF as its own line', async (t) => {
  if (!fs.existsSync(PDF)) {
    t.skip('fixture missing - run: python scripts/make_test_pdf.py');
    return;
  }

  // Legacy build is the Node-compatible entry point.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(PDF));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    pages.push(itemsToLines((await page.getTextContent()).items).join('\n'));
  }
  const text = cleanResumeText(pages.join('\n\n'));
  const lines = text.split('\n').filter(Boolean);

  // Every bullet must survive as its own line, with its number intact.
  const expected = [
    'Responsible for the merchant onboarding product area and its roadmap',
    'Cut merchant onboarding drop-off from 41% to 23% by removing two redundant KYC steps',
    'Ran 18 merchant interviews to identify why mid-market signups stalled, which redirected the Q3 roadmap',
    'Launched a self-serve settlement dashboard used by 4,200 merchants in the first quarter',
    'Shipped an automated evidence-collection flow that reduced manual dispute handling time by 60%',
    'Defined the dispute resolution SLA metric and drove it from 9 days to 4 days',
    'Built an internal tool that let support agents resolve tickets without escalating to engineering',
  ];

  for (const want of expected) {
    assert.ok(
      lines.some((l) => l.includes(want)),
      `bullet not recovered intact:\n  want: ${want}\n  got lines:\n${lines.map((l) => '    ' + l).join('\n')}`
    );
  }

  // Structure preserved: employers and dates on their own lines.
  assert.ok(lines.some((l) => l.includes('Senior Product Manager, Pine Labs')));
  assert.ok(lines.some((l) => /Mar 2023\s*-\s*Present/.test(l)));

  // The failure this whole module exists to prevent.
  assert.ok(
    lines.length >= 20,
    `expected ~25 discrete lines, got ${lines.length} - fragments are collapsing`
  );
  assert.ok(
    !lines.some((l) => l.length > 250),
    'a line ran long enough to suggest multiple bullets merged'
  );
});
