/**
 * The agent loop, running in the browser.
 *
 * State lives here rather than server-side because each /api route must stay
 * one short call to fit the free-tier serverless timeout. The tradeoff is that
 * a page refresh loses an in-flight run; the run is short enough that this is
 * acceptable for v1 (App.jsx warns on unload).
 *
 * Every step reports to onLog, which is what the progress view renders. The
 * log deliberately shows retries, caught fabrications, and honest give-ups —
 * that behaviour is the product, not an implementation detail to hide.
 */

import * as api from './api.js';
import { optimizeBullet, OUTCOME } from '../../shared/optimizeLoop.js';
import { competencyLabel, STRENGTH } from '../../shared/competencyModel.js';
import { REASON } from '../../shared/scoring.js';

export const LOG = {
  STEP: 'step',
  INFO: 'info',
  GOOD: 'good',
  WARN: 'warn',
  BAD: 'bad',
};

/**
 * What went wrong, stated without an implied next action.
 *
 * The action depends on whether another attempt follows, which the reason code
 * alone does not tell you — a retryable reason on the final attempt means the
 * agent gave up, not that it is about to try again.
 */
const REASON_TEXT = {
  [REASON.WEAK_PHRASING]: 'phrasing is weak',
  [REASON.NO_STAR_STRUCTURE]: 'no clear result',
  [REASON.FORMAT_FAIL]: 'breaks the format rules',
  [REASON.DUPLICATES_EXISTING]: 'borrowed another bullet’s achievement',
  [REASON.NO_QUANTIFIABLE_DATA]: 'no supporting data exists anywhere in your documents',
  [REASON.WOULD_REQUIRE_FABRICATION]: 'would require inventing a fact',
};

/** The action actually taken, given whether more attempts follow. */
function actionText(reason, isFinal) {
  if (reason === REASON.NO_QUANTIFIABLE_DATA) return 'will ask you instead';
  if (reason === REASON.WOULD_REQUIRE_FABRICATION) return 'refused';
  if (!isFinal) return 'retrying with a different angle';
  return 'out of attempts — flagging for you to review';
}

export async function runAgent({ resumeText, experienceText = '', seniority }, { onLog, onStep }) {
  const log = (kind, text) => onLog({ kind, text, at: Date.now() });
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const track = (meta) => {
    if (!meta?.usage) return;
    usage.calls += 1;
    usage.inputTokens += meta.usage.inputTokens ?? 0;
    usage.outputTokens += meta.usage.outputTokens ?? 0;
  };

  /* ---------- Step 1-2: parse + decompose ---------- */
  onStep(1);
  log(LOG.STEP, 'Reading your resume…');
  const dec = await api.decompose({ resumeText, experienceText });
  track(dec.meta);
  log(LOG.INFO, `Found ${dec.bullets.length} bullets across your experience.`);
  dec.warnings?.forEach((w) => log(LOG.WARN, w));

  /* ---------- Step 3: competency mapping ---------- */
  onStep(2);
  log(LOG.STEP, 'Checking which PM competencies your resume demonstrates…');
  const map = await api.mapCompetency({ bullets: dec.bullets, seniority });
  track(map.meta);

  const strong = map.bullets.filter((b) => b.strength === STRENGTH.STRONG).length;
  log(LOG.INFO, `${strong} of ${map.bullets.length} bullets already show a clear outcome.`);

  if (map.coverage.gapIds.length) {
    log(
      LOG.WARN,
      `Missing entirely for this level: ${map.coverage.gapIds.map(competencyLabel).join(', ')}.`
    );
  }
  log(LOG.INFO, `${map.rewriteIds.length} bullets queued for rewriting.`);

  /* ---------- Steps 4-6: rewrite / score / route ---------- */
  onStep(3);
  const byId = new Map(map.bullets.map((b) => [b.id, b]));
  const results = [];

  for (const [i, id] of map.rewriteIds.entries()) {
    const bullet = byId.get(id);
    const target = bullet.potentialCompetency ?? bullet.competency;
    const closesGap = map.coverage.gapIds.includes(target);

    log(
      LOG.STEP,
      `Rewriting ${i + 1} of ${map.rewriteIds.length}: “${truncate(bullet.text, 60)}”`
    );
    log(
      LOG.INFO,
      `Aiming for ${competencyLabel(target)}${closesGap ? ' — this closes a gap' : ''}.`
    );

    const res = await optimizeBullet(
      {
        bullet,
        targetCompetency: target,
        resumeText,
        experienceText,
        gapIds: map.coverage.gapIds,
        otherBullets: map.bullets.filter((o) => o.id !== id).map((o) => o.text),
      },
      {
        rewriteFn: api.rewrite,
        scoreFn: api.score,
        onProgress: () => {},
      }
    );

    usage.calls += res.usage.calls;
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;

    // Replay each attempt so the user sees the agent correcting itself.
    res.attempts.forEach((a, idx) => {
      const isFinal = idx === res.attempts.length - 1;
      if (a.reason === REASON.ACCEPTED) {
        log(LOG.GOOD, `Scored ${a.composite}% — accepted.`);
        return;
      }
      const why = REASON_TEXT[a.reason] ?? a.reason;
      log(
        isFinal ? LOG.BAD : LOG.WARN,
        `Scored ${a.composite}% — ${why}; ${actionText(a.reason, isFinal)}.`
      );
    });

    if (res.fabricatedClaims?.length) {
      log(LOG.BAD, `Refused unsupported claim: “${res.fabricatedClaims[0]}”`);
    }
    if (res.outcome === OUTCOME.NEEDS_CLARIFICATION) {
      log(LOG.WARN, 'Parked — your documents don’t contain the data this needs.');
    }

    results.push({ id, original: bullet.text, bullet, target, ...res });
  }

  /* ---------- Step 8: clarifying questions ---------- */
  onStep(4);
  const needInfo = results.filter((r) => r.outcome === OUTCOME.NEEDS_CLARIFICATION);
  let questions = [];

  if (needInfo.length) {
    log(LOG.STEP, 'Working out what to ask you…');
    const q = await api.generateQuestions({
      bullets: needInfo.map((r) => ({ id: r.id, text: r.original, bestRewrite: r.best?.rewrite })),
    });
    track(q.meta);
    questions = q.questions;
    log(LOG.INFO, `${questions.length} question(s) that would unlock stronger bullets.`);
  }

  /* ---------- Compile ---------- */
  onStep(5);
  const accepted = results.filter((r) => r.outcome === OUTCOME.ACCEPTED);
  const flagged = results.filter((r) => r.outcome === OUTCOME.FLAGGED);

  // Coverage after applying accepted rewrites: an accepted rewrite counts as a
  // strong bullet for its target competency. Same function, both sides.
  const afterBullets = map.bullets.map((b) => {
    const win = accepted.find((r) => r.id === b.id);
    return win ? { ...b, competency: win.target, strength: STRENGTH.STRONG } : b;
  });

  log(LOG.GOOD, `Done. ${accepted.length} improved, ${questions.length} question(s), ${flagged.length} flagged.`);

  return {
    bullets: map.bullets,
    afterBullets,
    coverageBefore: map.coverage,
    seniority,
    results,
    questions,
    usage,
  };
}

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
