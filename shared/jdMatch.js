/**
 * How well one bullet lines up with the target job description.
 *
 * Computed in code, not by the model, for three reasons:
 *   - it costs nothing, so every point can carry a before/after number
 *   - it is deterministic, so the same bullet never scores differently twice
 *   - it is explainable: the UI can name the exact JD requirement matched and
 *     the exact words that hit, which a model-produced percentage cannot do.
 *
 * Deliberately NOT called an ATS score (PRD §9). No applicant tracking system
 * works this way, and a label should say what the number actually measures:
 * term overlap between this bullet and the requirement it best answers.
 *
 * The JD stays a lens, never evidence. This module reads the JD to *rank*
 * wording; nothing here can put a JD claim into a candidate's bullet — that
 * separation is enforced upstream, where the scorer's fabrication check is
 * given the candidate's documents only.
 */

/** Words carrying no signal about what a bullet demonstrates. */
const STOPWORDS = new Set(
  ('a an and are as at be been being by for from had has have how in into is it its of on or over ' +
    'that the their them they this to under up was were what when which who will with within your ' +
    'you our we able about across after all also any both can could each else etc every ' +
    'including like made make many may more most must new non not other others per plus should ' +
    'some such than then there these those through using very well while would year years ' +
    'ability strong excellent good great proven track record experience experienced work working ' +
    'role team teams candidate candidates ideal preferred required requirements responsibilities ' +
    'plus bonus nice must-have day days week weeks month months')
    .split(' ')
);

/**
 * Crude suffix stripping — enough to make "prioritising" match "prioritization"
 * without pulling in a stemmer dependency. Over-stripping is acceptable here:
 * a false match inflates one bullet's percentage slightly, while a missed match
 * makes the tool look like it ignored an obvious hit.
 */
function stem(word) {
  let w = word;

  // Plural first, then one derivational suffix. Order matters: stripping only
  // one suffix per word would leave "decisions" -> "decision" while
  // "decision" -> "decis", so the two would never match each other.
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ie')) w = `${w.slice(0, -2)}y`;

  for (const suffix of ['ization', 'isation', 'ation', 'ement', 'ing', 'ise', 'ize', 'ion', 'ed', 'er']) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }

  // "strategy"/"strategies" -> "strateg"; "drive"/"driving" -> "driv"
  if (w.endsWith('y') && w.length > 4) w = w.slice(0, -1);
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

/** Content words of a phrase, stemmed and de-duplicated. */
export function terms(text) {
  if (!text) return new Set();
  const out = new Set();
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9+#.]+/)) {
    const word = raw.replace(/^[.]+|[.]+$/g, '');
    if (word.length < 3) continue;
    if (STOPWORDS.has(word)) continue;
    const s = stem(word);
    if (s.length >= 3 && !STOPWORDS.has(s)) out.add(s);
  }
  return out;
}

/**
 * The JD's requirements and responsibilities, pre-tokenised.
 *
 * Keywords are held separately: they are the posting's own vocabulary, and
 * hitting them is worth credit even when the bullet answers no single
 * requirement cleanly.
 */
export function indexJd(jd) {
  if (!jd) return null;
  const lines = [
    ...(jd.requirements ?? []).map((text) => ({ text, kind: 'requirement' })),
    ...(jd.responsibilities ?? []).map((text) => ({ text, kind: 'responsibility' })),
  ]
    .filter((l) => l.text?.trim())
    .map((l) => ({ ...l, terms: terms(l.text) }))
    .filter((l) => l.terms.size > 0);

  const keywords = (jd.keywords ?? [])
    .filter((k) => k?.trim())
    .map((k) => ({ text: k, terms: terms(k) }))
    .filter((k) => k.terms.size > 0);

  if (!lines.length && !keywords.length) return null;
  return { lines, keywords, title: jd.title ?? null };
}

/**
 * A requirement's coverage by a bullet.
 *
 * The denominator is floored at 3 and capped at 6 so a one-word requirement
 * can't hand out 100% on a single incidental word, and a rambling 30-word
 * requirement isn't unmatchable by a 150-character bullet.
 */
function coverage(bulletTerms, lineTerms) {
  const hits = [...lineTerms].filter((t) => bulletTerms.has(t));
  const denominator = Math.min(Math.max(lineTerms.size, 3), 6);
  return { ratio: Math.min(1, hits.length / denominator), hits };
}

/**
 * Match one bullet against an indexed JD.
 *
 * Returns null when there is no JD — the UI shows no percentage rather than a
 * zero, because "no target set" and "does not match the target" are different
 * statements and only one of them is the user's problem.
 *
 * @returns {{percent:number, best:{text:string,kind:string,hits:string[]}|null,
 *            keywordHits:string[]}|null}
 */
export function matchBullet(bulletText, index) {
  if (!index || !bulletText?.trim()) return null;
  const bulletTerms = terms(bulletText);

  let best = null;
  let bestRatio = 0;
  for (const line of index.lines) {
    const { ratio, hits } = coverage(bulletTerms, line.terms);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { text: line.text, kind: line.kind, hits };
    }
  }

  // A keyword counts as hit only if every content word in it appears, so
  // "payments platform" is not satisfied by the word "payments" alone.
  const keywordHits = index.keywords
    .filter((k) => [...k.terms].every((t) => bulletTerms.has(t)))
    .map((k) => k.text);

  // Three keywords is treated as full marks on vocabulary. Beyond that the
  // bullet is stuffed, and the specificity criterion penalises it elsewhere.
  const keywordRate = index.keywords.length ? Math.min(1, keywordHits.length / 3) : 0;

  // Answering a requirement is the substance; speaking the posting's language
  // is the garnish. Weighted accordingly.
  const blended = index.keywords.length ? 0.75 * bestRatio + 0.25 * keywordRate : bestRatio;

  return {
    percent: Math.round(blended * 100),
    best,
    keywordHits,
  };
}

/**
 * What the loop aims for on each point.
 *
 * A goal, not a guarantee. Many postings ask for things no bullet can ever
 * evidence — "4-7 years of experience", "based in Singapore" — and the only
 * way to force every point over an arbitrary line is to stuff it with the
 * posting's words, which §9 forbids and which makes the number meaningless.
 * The loop tries to reach this honestly and reports the real figure when it
 * can't.
 */
export const JD_MATCH_TARGET = 90;

/**
 * The percentage, said in words.
 *
 * A raw number invites a reading it can't support: 42% looks like a failing
 * grade when it is a normal score for a good bullet, because term overlap with
 * a verbose requirement sentence tops out well below 100. Measured: a bullet
 * ideally suited to a posting scored 25%. The band is what the number actually
 * means; the percentage stays visible beside it so movement is still legible.
 */
export const MATCH_BANDS = [
  { id: 'strong', min: 60, label: 'strong fit' },
  { id: 'partial', min: 30, label: 'partial fit' },
  { id: 'weak', min: 0, label: 'weak fit' },
];

export function matchBand(percent) {
  if (percent == null) return null;
  return MATCH_BANDS.find((b) => percent >= b.min) ?? MATCH_BANDS[MATCH_BANDS.length - 1];
}

/**
 * The posting's words this bullet is closest to using but doesn't.
 *
 * Fed back into a retry so the rewriter can reach for the posting's own
 * vocabulary where the candidate's material genuinely supports it. The
 * fabrication check never sees the JD, so anything the rewriter launders in
 * to chase these terms is still caught as an unsupported claim.
 */
export function missingTerms(bulletText, index) {
  const m = matchBullet(bulletText, index);
  if (!m?.best) return null;

  const line = index.lines.find((l) => l.text === m.best.text);
  const hits = new Set(m.best.hits);
  return {
    requirement: m.best.text,
    missing: [...line.terms].filter((t) => !hits.has(t)),
    percent: m.percent,
  };
}

/**
 * Share of the JD's requirements answered by at least one bullet in a set.
 *
 * Section-level headline: "this section speaks to 4 of the 9 things the posting
 * asks for". A requirement counts as answered at 50% coverage — half its
 * content words present — which in practice means the bullet is about that
 * requirement rather than brushing past one of its words.
 */
export function coverJd(bulletTexts, index) {
  if (!index || !index.lines.length) return null;
  const bulletTermSets = bulletTexts.filter(Boolean).map((t) => terms(t));

  const answered = index.lines.filter((line) =>
    bulletTermSets.some((bt) => coverage(bt, line.terms).ratio >= 0.5)
  );

  return {
    answered: answered.length,
    total: index.lines.length,
    percent: Math.round((answered.length / index.lines.length) * 100),
    unanswered: index.lines.filter((l) => !answered.includes(l)).map((l) => l.text),
  };
}
