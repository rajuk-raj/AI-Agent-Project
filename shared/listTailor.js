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
