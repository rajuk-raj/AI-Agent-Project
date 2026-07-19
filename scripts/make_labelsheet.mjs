/**
 * Generates the labelling worksheet you fill in by hand.
 *
 * Writes eval/labels.csv with one row per corpus bullet and two blank columns
 * for your judgment. Opens cleanly in Excel.
 *
 * Usage:  node scripts/make_labelsheet.mjs
 *
 * Refuses to overwrite an existing labels.csv - your labels are the one thing
 * here that cannot be regenerated.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPETENCIES } from '../shared/competencyModel.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(ROOT, 'eval/corpus.json');
const OUT = path.join(ROOT, 'eval/labels.csv');

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function main() {
  if (fs.existsSync(OUT)) {
    console.error(`Refusing to overwrite ${path.relative(ROOT, OUT)} - it may contain your labels.`);
    console.error('Delete or rename it first if you really want a fresh sheet.');
    process.exit(1);
  }

  const { bullets } = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));

  const rows = [
    ['id', 'bullet', 'seniority', 'your_competency', 'your_strength', 'notes'],
    ...bullets.map((b) => [b.id, b.text, b.seniority, '', '', b.disputed ? 'models disagreed here' : '']),
  ];

  fs.writeFileSync(OUT, rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');

  console.log(`Wrote ${path.relative(ROOT, OUT)} - ${bullets.length} bullets to label.\n`);
  console.log('Fill in two columns for each row:\n');
  console.log('  your_competency - exactly one of:');
  for (const c of COMPETENCIES) console.log(`      ${c.id.padEnd(15)} ${c.shows}`);
  console.log(`      ${'NONE'.padEnd(15)} not an accomplishment bullet at all (skills line, header)\n`);
  console.log('  your_strength - exactly one of:');
  console.log('      strong   demonstrates the competency AND states an outcome (what changed)');
  console.log('      weak     describes real work but states no outcome');
  console.log('      none     not an accomplishment bullet at all\n');
  console.log('Rows marked "models disagreed here" are the ones that matter most - the');
  console.log('two models we tested gave opposite answers, so your call is the tiebreak.\n');
  console.log('When done:  node --env-file=.env.local scripts/run_eval.mjs');
}

main();
