/**
 * Dev harness — runs the built pipeline steps against a resume and prints
 * results plus token usage. Calls the tool functions directly, so no server
 * is needed.
 *
 * Usage (Node 24 loads the env file natively):
 *   node --env-file=.env.local scripts/run_pipeline.mjs
 *   node --env-file=.env.local scripts/run_pipeline.mjs path/to/resume.txt
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decompose } from '../api/decompose.js';
import { mapCompetency } from '../api/map-competency.js';
import { rewrite } from '../api/rewrite.js';
import { score } from '../api/score.js';
import { generateQuestions } from '../api/questions.js';
import { competencyLabel } from '../shared/competencyModel.js';
import { optimizeBullet, OUTCOME } from '../shared/optimizeLoop.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const resumePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'test/fixtures/sample-resume.txt');

const SENIORITY = process.env.SENIORITY || 'SENIOR_PM';

const totals = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, calls: 0 };
function track(meta, label) {
  const u = meta.usage;
  totals.inputTokens += u.inputTokens;
  totals.outputTokens += u.outputTokens;
  totals.thinkingTokens += u.thinkingTokens;
  totals.calls += 1;
  const reasoning = u.thinkingTokens ? `, ${u.thinkingTokens} reasoning` : '';
  console.log(`   [${label}] ${u.inputTokens} in / ${u.outputTokens} out${reasoning}`);
}

function rule(title) {
  console.log(`\n${'='.repeat(64)}\n${title}\n${'='.repeat(64)}`);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set. Run with:  node --env-file=.env.local scripts/run_pipeline.mjs');
    process.exit(1);
  }
  if (!fs.existsSync(resumePath)) {
    console.error(`Resume not found: ${resumePath}`);
    process.exit(1);
  }

  const resumeText = fs.readFileSync(resumePath, 'utf8');
  console.log(`Resume:    ${path.relative(ROOT, resumePath)}`);
  console.log(`Seniority: ${SENIORITY}`);

  /* ---- Step 2: decompose ---- */
  rule('STEP 2 - DECOMPOSE');
  const started = Date.now();
  const dec = await decompose({ resumeText });
  track(dec.meta, 'decompose');
  console.log(`   Found ${dec.bullets.length} bullets\n`);
  for (const b of dec.bullets) {
    const where = [b.company, b.role].filter(Boolean).join(' / ') || b.section;
    console.log(`   ${b.id.padEnd(4)} [${where}]`);
    console.log(`        ${b.text}`);
  }
  if (dec.warnings.length) {
    console.log('\n   WARNINGS:');
    dec.warnings.forEach((w) => console.log(`     ! ${w}`));
  }

  /* ---- Step 3: competency mapping ---- */
  rule('STEP 3 - COMPETENCY MAPPING');
  const map = await mapCompetency({ bullets: dec.bullets, seniority: SENIORITY });
  track(map.meta, 'competency');

  const strengthMark = { strong: '++', weak: ' ~', none: ' -' };
  console.log();
  for (const b of map.bullets) {
    // Show the rewriter's target when it differs from what the bullet shows today.
    const target =
      b.strength !== 'strong' && b.potentialCompetency && b.potentialCompetency !== b.competency
        ? ` -> aim: ${b.potentialCompetency}`
        : '';
    console.log(
      `   ${strengthMark[b.strength] ?? '  '} ${b.id.padEnd(4)} ${b.competency.padEnd(15)}${target.padEnd(22)} ${b.text.slice(0, 46)}`
    );
    console.log(`          ${b.rationale}`);
  }
  if (map.warnings.length) {
    console.log('\n   WARNINGS:');
    map.warnings.forEach((w) => console.log(`     ! ${w}`));
  }

  /* ---- Coverage ---- */
  rule('COMPETENCY COVERAGE');
  const { coverage } = map;
  console.log(`   Coverage: ${coverage.display} competencies with at least one strong bullet\n`);
  for (const [id, counts] of Object.entries(coverage.byCompetency)) {
    const bar = '#'.repeat(counts.strong) + '.'.repeat(counts.weak);
    const gap = coverage.gapIds.includes(id) ? '  <- GAP for this seniority' : '';
    console.log(
      `   ${competencyLabel(id).padEnd(34)} ${String(counts.strong).padStart(2)} strong / ${counts.weak} weak  ${bar}${gap}`
    );
  }
  console.log(
    `\n   Queued for rewrite (${map.rewriteIds.length}/${map.bullets.length}): ` +
      `${map.rewriteIds.length ? map.rewriteIds.join(', ') : 'none'}`
  );

  /* ---- Steps 4-6: rewrite / score / route ---- */
  rule('STEPS 4-6 - REWRITE, SCORE, ROUTE');

  // Cap by default: 10 bullets x up to 4 attempts x 2 calls is a lot of calls
  // for an exploratory run. Set MAX_BULLETS=0 for the whole resume.
  const cap = process.env.MAX_BULLETS === undefined ? 4 : Number(process.env.MAX_BULLETS);
  const queue = cap > 0 ? map.rewriteIds.slice(0, cap) : map.rewriteIds;
  if (cap > 0 && map.rewriteIds.length > cap) {
    console.log(`   (processing ${queue.length} of ${map.rewriteIds.length}; set MAX_BULLETS=0 for all)\n`);
  }

  const byId = new Map(map.bullets.map((b) => [b.id, b]));
  const results = [];

  for (const id of queue) {
    const b = byId.get(id);
    const target = b.potentialCompetency ?? b.competency;

    console.log(`   ${id}  "${b.text}"`);
    console.log(`        target: ${target}${coverage.gapIds.includes(target) ? '  (closes a gap)' : ''}`);

    const res = await optimizeBullet(
      {
        bullet: b,
        targetCompetency: target,
        resumeText,
        gapIds: coverage.gapIds,
        // Every other bullet, so the rewriter and scorer both know which
        // achievements are already spoken for.
        otherBullets: map.bullets.filter((o) => o.id !== b.id).map((o) => o.text),
      },
      {
        rewriteFn: rewrite,
        scoreFn: score,
        onProgress: (line) => console.log(`        ${line}`),
      }
    );

    totals.inputTokens += res.usage.inputTokens;
    totals.outputTokens += res.usage.outputTokens;
    totals.thinkingTokens += res.usage.thinkingTokens;
    totals.calls += res.usage.calls;

    const verdict =
      res.outcome === OUTCOME.ACCEPTED ? 'ACCEPTED'
      : res.outcome === OUTCOME.NEEDS_CLARIFICATION ? 'NEEDS INFO FROM CANDIDATE'
      : 'FLAGGED FOR HUMAN REVIEW';

    console.log(`        => ${verdict}`);
    console.log(`        "${res.best.rewrite}"  [${res.best.rewrite.length} chars]`);
    if (res.best.claimsUsed?.length) {
      console.log(`        drew on: ${res.best.claimsUsed.map((c) => `"${c}"`).join(', ')}`);
    }
    if (res.fabricatedClaims.length) {
      console.log(`        !! UNSUPPORTED CLAIMS: ${res.fabricatedClaims.join(' | ')}`);
    }
    console.log();

    results.push({ id, original: b.text, ...res });
  }

  /* ---- Step 8: clarification questions ---- */
  const needInfo = results.filter((r) => r.outcome === OUTCOME.NEEDS_CLARIFICATION);
  if (needInfo.length) {
    rule('STEP 8 - CLARIFICATION QUESTIONS');
    const q = await generateQuestions({
      bullets: needInfo.map((r) => ({
        id: r.id,
        text: r.original,
        bestRewrite: r.best?.rewrite,
      })),
    });
    if (q.meta) {
      totals.inputTokens += q.meta.usage.inputTokens;
      totals.outputTokens += q.meta.usage.outputTokens;
      totals.thinkingTokens += q.meta.usage.thinkingTokens;
      totals.calls += 1;
    }
    console.log(`   ${q.questions.length} question(s) for the candidate:\n`);
    for (const item of q.questions) {
      console.log(`   [${item.bulletId}] ${item.question}`);
      console.log(`         unlocks: ${item.whatItUnlocks}\n`);
    }
    console.log('   Answers are folded into the source documents and only those');
    console.log('   bullets re-run (shared/clarification.js). The UI drives that step.');
  }

  /* ---- Outcome summary ---- */
  rule('OUTCOMES');
  const counts = results.reduce((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  console.log(`   Accepted:              ${counts[OUTCOME.ACCEPTED] ?? 0}`);
  console.log(`   Needs candidate input: ${counts[OUTCOME.NEEDS_CLARIFICATION] ?? 0}`);
  console.log(`   Flagged for review:    ${counts[OUTCOME.FLAGGED] ?? 0}`);
  const fabricated = results.filter((r) => r.fabricatedClaims.length).length;
  console.log(`   Fabrication caught:    ${fabricated}${fabricated ? '  <- inspect these' : ''}`);
  const avgAttempts = results.length
    ? (results.reduce((a, r) => a + r.attempts.length, 0) / results.length).toFixed(1)
    : 0;
  console.log(`   Avg attempts/bullet:   ${avgAttempts}`);

  /* ---- Cost ---- */
  rule('USAGE');
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`   ${totals.calls} API calls in ${secs}s`);
  console.log(`   Input:     ${totals.inputTokens} tokens`);
  console.log(`   Output:    ${totals.outputTokens} tokens (of which ${totals.thinkingTokens} reasoning)`);
  const pct = totals.outputTokens
    ? Math.round((totals.thinkingTokens / totals.outputTokens) * 100)
    : 0;
  console.log(`   Reasoning overhead: ${pct}% of output tokens`);
  console.log('\n   Multiply by your model\'s per-token price for cost. Steps 4-6 (rewrite,');
  console.log('   score, retries) will add roughly one call per weak bullet, plus retries.');
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  if (err.cause) console.error(err.cause);
  process.exit(1);
});
