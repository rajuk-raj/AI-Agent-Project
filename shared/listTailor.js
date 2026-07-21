/**
 * Tailoring a roster — skills, tools, languages — to a job description.
 *
 * A list has no action and no result, so there is nothing for the STAR
 * rewriter to do with it. What genuinely helps is ORDER: a recruiter scanning
 * "Technical Skills" reads the first few items, and the ones the posting asks
 * for should be there.
 *
 * This is done entirely in code, and the reason is a guarantee rather than
 * cost. A model asked to "tailor my skills to this job" will add skills the
 * candidate never claimed — the single most damaging thing this product could
 * do, since a skills list is exactly what gets probed in a screening call.
 * Reordering cannot invent: the output is the input, permuted, and
 * `reorderByJd` verifies that before returning.
 */

import { terms } from './jdMatch.js';

/**
 * Does one list item name the same thing as one JD phrase?
 *
 * Containment both ways, so "Advanced Excel" answers a posting asking for
 * "Excel" and a list entry of "SQL" answers "strong SQL skills". Requiring an
 * exact string match would miss most real pairs; requiring a single shared
 * word would match "Advanced Excel" to "advanced analytics".
 */
function sameThing(itemTerms, phraseTerms) {
  if (!itemTerms.length || !phraseTerms.length) return false;
  const inItem = phraseTerms.every((t) => itemTerms.includes(t));
  const inPhrase = itemTerms.every((t) => phraseTerms.includes(t));
  return inItem || inPhrase;
}

/**
 * Score a roster against the specific things the posting names.
 *
 * A skills line scored the ordinary way — term overlap with the requirement it
 * best answers — produces a number that means nothing: a list of eleven tools
 * has no prose to overlap with. The question a candidate actually has is "how
 * many of the tools this job names do I have?", so that is what this measures,
 * and the denominator is the posting's own vocabulary.
 *
 * `missing` is reported so the gap is visible. It is never auto-added: whether
 * the candidate knows a tool is a fact only they have.
 *
 * @returns {{percent:number, have:string[], missing:string[]}|null}
 */
export function matchListToJd(text, index) {
  if (!index?.keywords?.length) return null;
  const { items } = splitList(text);
  if (!items.length) return null;

  const universe = namedThings(index.keywords);
  if (!universe.length) return null;

  const itemTermLists = items.map((i) => [...terms(i)]);

  const have = [];
  const missing = [];
  for (const kw of universe) {
    const kwTerms = [...kw.terms];
    const hit = itemTermLists.some((it) => sameThing(it, kwTerms));
    (hit ? have : missing).push(kw.text);
  }

  return {
    percent: Math.round((have.length / universe.length) * 100),
    have,
    missing,
  };
}

/**
 * The keywords that name a thing you could list, as opposed to describe work.
 *
 * Without this filter the denominator is wrong in a way that reads as the
 * candidate's fault. Measured on a real posting: a Tools line holding every
 * tool the ad named scored "3 of 13 — weak fit", because the other ten
 * keywords were phrases like "merchant activation" and "signup funnel" that
 * belong in a bullet, not a tool list.
 *
 * Proper nouns and acronyms are the signal — Figma, JIRA, SQL, Advanced Excel.
 * If nearly everything qualifies the posting is probably Title Cased, in which
 * case the signal is absent and the full set is the honest denominator.
 */
function namedThings(keywords) {
  const named = keywords.filter((k) => /(^|\s)[A-Z]/.test(k.text));
  return named.length && named.length <= keywords.length * 0.7 ? named : keywords;
}

/**
 * Split a list line into its items.
 *
 * Handles "Technical Skills: SQL, Python, Linux" and bare "SQL, Python · Linux"
 * alike. The label, if present, is returned separately so it can be put back
 * exactly as written.
 */
export function splitList(text) {
  if (!text?.trim()) return { label: null, items: [] };

  // A leading "Label:" — but not a colon inside an item, so only match a short
  // label at the very start.
  const m = text.match(/^\s*([^:•\n]{2,40}?):\s*(.+)$/s);
  const label = m ? m[1].trim() : null;
  const body = m ? m[2] : text;

  const items = body
    .split(/[,;·|]|\s+•\s+/)
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter(Boolean);

  return { label, items };
}

/** Put a label and items back together the way they were written. */
export function joinList(label, items) {
  const body = items.join(', ');
  return label ? `${label}: ${body}` : body;
}

/**
 * Reorder a list so the items the posting asks for come first.
 *
 * Relative order is preserved within each group, so an unmatched list comes
 * back untouched rather than shuffled for no reason.
 *
 * @returns {{text:string, items:string[], matched:string[], changed:boolean}|null}
 */
export function reorderByJd(text, index) {
  if (!index) return null;
  const { label, items } = splitList(text);
  if (items.length < 2) return null;

  // Everything the posting says, as one bag of terms. Which requirement a
  // skill answers doesn't matter here — only whether the posting mentions it.
  const jdTerms = new Set();
  for (const line of index.lines) for (const t of line.terms) jdTerms.add(t);
  for (const k of index.keywords) for (const t of k.terms) jdTerms.add(t);

  const scored = items.map((item, i) => {
    const itemTerms = [...terms(item)];
    const hit = itemTerms.length > 0 && itemTerms.every((t) => jdTerms.has(t));
    return { item, i, hit };
  });

  const ordered = [
    ...scored.filter((s) => s.hit),
    ...scored.filter((s) => !s.hit),
  ].map((s) => s.item);

  // The guarantee, checked rather than asserted: same items, same count.
  const before = [...items].sort();
  const after = [...ordered].sort();
  if (before.length !== after.length || before.some((v, i) => v !== after[i])) {
    return null;
  }

  return {
    text: joinList(label, ordered),
    items: ordered,
    matched: scored.filter((s) => s.hit).map((s) => s.item),
    changed: ordered.some((v, i) => v !== items[i]),
  };
}
