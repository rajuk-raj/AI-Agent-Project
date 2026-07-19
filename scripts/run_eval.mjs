/**
 * Eval harness — scores the competency mapper against your hand labels.
 *
 * This is the instrument that makes prompt and model changes measurable
 * instead of arguable. Run it after ANY change to the rubric, the prompt, the
 * threshold, or the model.
 *
 * Usage:
 *   node --env-file=.env.local scripts/run_eval.mjs
 *   node --env-file=.env.local scripts/run_eval.mjs --save baseline
 *
 * Saved runs land in eval/runs/ (gitignored - they contain resume text).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mapCompetency } from '../api/map-competency.js';
import { COMPETENCY_IDS } from '../shared/competencyModel.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(ROOT, 'eval/corpus.json');
const LABELS = path.join(ROOT, 'eval/labels.csv');

const VALID_COMPETENCY = new Set([...COMPETENCY_IDS, 'NONE']);
const VALID_STRENGTH = new Set(['strong', 'weak', 'none']);

/** Minimal CSV parser - handles quoted fields containing commas. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

function loadLabels() {
  if (!fs.existsSync(LABELS)) {
    console.error('eval/labels.csv not found. Generate it first:\n  node scripts/make_labelsheet.mjs');
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(LABELS, 'utf8'));
  const labelled = [], problems = [];

  for (const r of rows) {
    const comp = r.your_competency?.toUpperCase();
    const str = r.your_strength?.toLowerCase();
    if (!comp && !str) continue; // not labelled yet - fine, just skip

    if (!VALID_COMPETENCY.has(comp)) {
      problems.push(`${r.id}: "${r.your_competency}" is not a valid competency`);
      continue;
    }
    if (!VALID_STRENGTH.has(str)) {
      problems.push(`${r.id}: "${r.your_strength}" is not a valid strength`);
      continue;
    }
    labelled.push({ id: r.id, competency: comp, strength: str, notes: r.notes });
  }

  if (problems.length) {
    console.error('Problems in labels.csv:');
    problems.forEach((p) => console.error(`  ${p}`));
    console.error('\nFix these and re-run.');
    process.exit(1);
  }
  return labelled;
}

function pct(n, d) {
  return d === 0 ? '  n/a' : `${((n / d) * 100).toFixed(1).padStart(5)}%`;
}

function rule(t) {
  console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);
}

async function main() {
  const { bullets } = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const labels = loadLabels();

  if (labels.length === 0) {
    console.error('No labelled rows in eval/labels.csv yet. Fill in the two blank columns first.');
    process.exit(1);
  }

  const byId = new Map(bullets.map((b) => [b.id, b]));
  const subject = labels.map((l) => ({ id: l.id, text: byId.get(l.id).text, section: 'EXPERIENCE' }));

  console.log(`Evaluating ${subject.length} labelled bullets against the competency mapper...`);
  const started = Date.now();
  const result = await mapCompetency({ bullets: subject, seniority: 'PM' });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const predById = new Map(result.bullets.map((b) => [b.id, b]));

  /* ---- Agreement ---- */
  let compHits = 0, strHits = 0, bothHits = 0;
  const disagreements = [];
  // Confusion: human strength -> model strength
  const confusion = {
    strong: { strong: 0, weak: 0, none: 0 },
    weak: { strong: 0, weak: 0, none: 0 },
    none: { strong: 0, weak: 0, none: 0 },
  };

  for (const l of labels) {
    const p = predById.get(l.id);
    const compOk = p.competency === l.competency;
    const strOk = p.strength === l.strength;

    if (compOk) compHits++;
    if (strOk) strHits++;
    if (compOk && strOk) bothHits++;
    confusion[l.strength][p.strength]++;

    if (!compOk || !strOk) {
      disagreements.push({
        id: l.id,
        text: byId.get(l.id).text,
        human: `${l.competency}/${l.strength}`,
        model: `${p.competency}/${p.strength}`,
        disputed: byId.get(l.id).disputed,
        rationale: p.rationale,
      });
    }
  }

  const n = labels.length;

  rule('AGREEMENT WITH YOUR LABELS');
  console.log(`   Competency tag:   ${pct(compHits, n)}   (${compHits}/${n})`);
  console.log(`   Strength:         ${pct(strHits, n)}   (${strHits}/${n})   <- the number that gates the build`);
  console.log(`   Both correct:     ${pct(bothHits, n)}   (${bothHits}/${n})`);
  console.log(`\n   PRD §8 target for strength agreement: 80%.`);
  console.log(
    strHits / n >= 0.8
      ? '   PASS - the scorer tracks your judgment well enough to trust downstream.'
      : '   BELOW TARGET - see the disagreements below before trusting any score built on this.'
  );

  /* ---- Confusion matrix: shows the DIRECTION of the bias ---- */
  rule('STRENGTH CONFUSION  (rows = your label, cols = model)');
  console.log('                  strong    weak    none');
  for (const h of ['strong', 'weak', 'none']) {
    const r = confusion[h];
    console.log(
      `   you: ${h.padEnd(8)} ${String(r.strong).padStart(6)}  ${String(r.weak).padStart(6)}  ${String(r.none).padStart(6)}`
    );
  }
  const overCredit = confusion.weak.strong + confusion.none.strong;
  const underCredit = confusion.strong.weak + confusion.strong.none;
  console.log(`\n   Over-credited (you said not-strong, model said strong):  ${overCredit}`);
  console.log(`   Under-credited (you said strong, model said not):        ${underCredit}`);
  if (overCredit > underCredit) {
    console.log('   -> Model is too generous. Tighten the strength criterion in the prompt.');
  } else if (underCredit > overCredit) {
    console.log('   -> Model is too harsh. Bullets that deserve credit are being queued for rewrite.');
  } else if (overCredit || underCredit) {
    console.log('   -> Errors are balanced, so this is noise rather than bias. Prompt tweaks will not fix it.');
  }

  /* ---- Disagreements ---- */
  if (disagreements.length) {
    rule(`DISAGREEMENTS (${disagreements.length})`);
    for (const d of disagreements) {
      console.log(`   ${d.id}${d.disputed ? '  [disputed case]' : ''}`);
      console.log(`     "${d.text}"`);
      console.log(`     you: ${d.human}    model: ${d.model}`);
      console.log(`     model said: ${d.rationale}\n`);
    }
  }

  /* ---- Save ---- */
  const saveIdx = process.argv.indexOf('--save');
  if (saveIdx !== -1) {
    const name = process.argv[saveIdx + 1] || `run-${Date.now()}`;
    const dir = path.join(ROOT, 'eval/runs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          name,
          at: new Date().toISOString(),
          model: result.meta.model,
          n,
          competencyAgreement: compHits / n,
          strengthAgreement: strHits / n,
          confusion,
          disagreements,
          usage: result.meta.usage,
        },
        null,
        2
      )
    );
    console.log(`\nSaved to ${path.relative(ROOT, file)} - compare against this after your next change.`);
  }

  console.log(`\n   ${secs}s, ${result.meta.usage.inputTokens} in / ${result.meta.usage.outputTokens} out, model ${result.meta.model}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
});
