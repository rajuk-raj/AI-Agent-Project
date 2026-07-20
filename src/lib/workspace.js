/**
 * Workspace operations — the agent loop, scoped to one user request at a time.
 *
 * The self-correction that used to run across a whole resume now runs inside a
 * single generation: bullets are generated, each is scored, and the ones that
 * fail on grounds a rewrite can fix are quietly regenerated before the user
 * ever sees them. What surfaces is the verdict, with the working available on
 * demand.
 */

import * as api from './api.js';
import { REASON, ROUTE } from '../../shared/scoring.js';

export const VERDICT = {
  GOOD: 'good',
  NEEDS_DATA: 'needs_data',
  REFUSED: 'refused',
  WEAK: 'weak',
};

/** Plain-language verdict for a scored bullet, plus whether to keep it. */
function verdictFor(scored) {
  if (scored.fabricationRisk) {
    return {
      verdict: VERDICT.REFUSED,
      note: `Dropped — would have claimed “${scored.fabricatedClaims[0] ?? 'something not in your documents'}”, which isn’t in your documents.`,
    };
  }
  if (scored.duplicatesAnotherBullet) {
    return {
      verdict: VERDICT.REFUSED,
      note: 'Dropped — this achievement is already claimed by another bullet on your resume.',
    };
  }
  if (scored.reason === REASON.NO_QUANTIFIABLE_DATA) {
    return {
      verdict: VERDICT.NEEDS_DATA,
      note: 'No number for this exists in your documents. Add it to your notes and regenerate.',
    };
  }
  if (scored.route === ROUTE.ACCEPT) {
    return { verdict: VERDICT.GOOD, note: null };
  }
  return { verdict: VERDICT.WEAK, note: scored.rationale };
}

async function scoreBullet({ bullet, section, session }) {
  const scored = await api.score({
    // A generated bullet has no "original"; the request it came from is the
    // closest thing to intent, and the scorer needs something to compare against.
    original: bullet.basedOn ?? section.request,
    rewrite: bullet.text,
    targetCompetency: bullet.competency,
    resumeText: session.resumeText,
    experienceText: session.experienceText,
    otherBullets: (session.analysis?.bullets ?? [])
      .map((b) => b.text)
      .filter((t) => t !== bullet.basedOn),
  });
  return { scored, ...verdictFor(scored) };
}

/**
 * One-time analysis after documents are supplied.
 *
 * Runs decompose + competency mapping so every later generation knows what is
 * already on the resume (to avoid duplicating it) and which competencies are
 * missing (to aim at them). Cached in the session — this does not re-run per
 * request.
 */
export async function analyzeDocuments({ resumeText, experienceText, seniority }, { onStage = () => {} } = {}) {
  onStage('Reading your resume…');
  const dec = await api.decompose({ resumeText, experienceText });

  onStage(`Assessing ${dec.bullets.length} bullets against the PM competency model…`);
  const map = await api.mapCompetency({ bullets: dec.bullets, seniority });

  return {
    bullets: map.bullets,
    coverage: map.coverage,
    weakIds: map.rewriteIds,
    analyzedAt: Date.now(),
    usage: {
      calls: 2,
      inputTokens: (dec.meta.usage.inputTokens ?? 0) + (map.meta.usage.inputTokens ?? 0),
      outputTokens: (dec.meta.usage.outputTokens ?? 0) + (map.meta.usage.outputTokens ?? 0),
    },
  };
}

/**
 * Generate a section, then self-check every bullet in it.
 *
 * @param {object} session
 * @param {string} request
 * @param {object} cb  { onStage, onBullets }
 */
export async function generateSection(session, request, { onStage = () => {}, onBullets = () => {} } = {}) {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const track = (meta) => {
    if (!meta?.usage) return;
    usage.calls += 1;
    usage.inputTokens += meta.usage.inputTokens ?? 0;
    usage.outputTokens += meta.usage.outputTokens ?? 0;
  };

  onStage('Reading your documents and drafting bullets…');
  const gen = await api.generate({
    request,
    resumeText: session.resumeText,
    experienceText: session.experienceText,
    existingBullets: (session.analysis?.bullets ?? []).map((b) => b.text),
    gapIds: session.analysis?.coverage?.gapIds ?? [],
    seniority: session.seniority,
  });
  track(gen.meta);

  const section = { request, heading: gen.heading, unsupported: gen.unsupported };

  // Show the drafts immediately, marked as checking. The user watches the
  // agent grade its own work rather than staring at a spinner.
  let bullets = gen.bullets.map((b) => ({ ...b, checking: true, verdict: null, note: null }));
  onBullets([...bullets]);

  onStage(`Checking ${bullets.length} bullets against your documents…`);

  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    let { scored, verdict, note } = await scoreBullet({ bullet: b, section: { request }, session });
    track(scored.meta);

    let attempts = 1;

    // One quiet retry for problems a rewrite can actually fix. Fabrication and
    // duplication are not retried — the model has already shown what it will
    // reach for, and a second roll of the dice is not a correction.
    if (verdict === VERDICT.WEAK && !scored.fabricationRisk && !scored.duplicatesAnotherBullet) {
      onStage(`Bullet ${i + 1} scored ${scored.composite}% — trying a stronger version…`);
      try {
        const better = await api.refine({
          bullet: b.text,
          instruction:
            'Make this stronger: lead with a specific action and state what changed as a result. ' +
            'Use only facts already present in the source documents.',
          resumeText: session.resumeText,
          experienceText: session.experienceText,
          otherBullets: bullets.filter((x) => x.id !== b.id).map((x) => x.text),
        });
        track(better.meta);

        if (!better.refused) {
          const recheck = await scoreBullet({
            bullet: { ...b, text: better.text },
            section: { request },
            session,
          });
          track(recheck.scored.meta);
          attempts = 2;
          // Keep the retry only if it actually improved.
          if (recheck.scored.composite > scored.composite) {
            b.text = better.text;
            b.claimsUsed = better.claimsUsed;
            b.format = better.format;
            ({ scored, verdict, note } = recheck);
          }
        }
      } catch {
        // A failed refinement is not fatal; keep the original draft.
      }
    }

    bullets[i] = {
      ...b,
      checking: false,
      verdict,
      note,
      score: scored.composite,
      scores: scored.scores,
      attempts,
      dropped: verdict === VERDICT.REFUSED,
    };
    onBullets([...bullets]);
  }

  return { section, bullets, usage };
}

/** Apply a user instruction to one bullet, then re-check it. */
export async function refineBullet(session, { bullet, instruction, siblings = [] }) {
  const res = await api.refine({
    bullet: bullet.text,
    instruction,
    resumeText: session.resumeText,
    experienceText: session.experienceText,
    otherBullets: siblings.filter((t) => t !== bullet.text),
  });

  if (res.refused) {
    // The agent declined rather than inventing. Surface it verbatim — this is
    // the moment the product's promise is most visible to the user.
    return { refused: res.refused, bullet, usage: res.meta.usage };
  }

  const next = { ...bullet, text: res.text, claimsUsed: res.claimsUsed, format: res.format };
  const { scored, verdict, note } = await scoreBullet({
    bullet: next,
    section: { request: '' },
    session,
  });

  return {
    refused: null,
    bullet: {
      ...next,
      verdict,
      note,
      score: scored.composite,
      scores: scored.scores,
      attempts: (bullet.attempts ?? 1) + 1,
      dropped: verdict === VERDICT.REFUSED,
    },
    usage: { calls: 2 },
  };
}
