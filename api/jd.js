/**
 * Job description resolution.
 *
 * Two ways in:
 *   - search: company + role -> Serper -> fetch the best result -> structure it
 *   - paste:  the user's own text -> structure it
 *
 * Provenance is returned with the result and shown in the UI, because how the
 * JD was obtained determines how much it should be trusted. A JD assembled
 * from search snippets is not the same artefact as a posting the user pasted,
 * and presenting them identically would be dishonest.
 *
 * Deliberately NOT offered: generating a JD from the model's own knowledge of
 * a company. That produces a confident, plausible, unverifiable target — and
 * tailoring a resume to an invented standard is the same failure this product
 * refuses everywhere else.
 */

import { callLLM, handler } from './_llm.js';
import { JD_SCHEMA, JD_SYSTEM, jdPrompt } from './_prompts.js';
import { searchJobDescription, fetchPageText } from './_search.js';

export const ORIGIN = {
  PASTED: 'pasted',
  FETCHED: 'fetched',
  SNIPPETS: 'snippets',
};

async function structure({ sourceText, company, role, origin }) {
  const { data, usage, model } = await callLLM({
    tool: 'competency',
    system: JD_SYSTEM,
    prompt: jdPrompt({ sourceText, company, role, origin }),
    schema: JD_SCHEMA,
    schemaName: 'job_description',
    maxOutputTokens: 4000,
  });
  return { jd: data, meta: { model, usage } };
}

export async function resolveJd({ mode, company, role, pastedText }) {
  /* ---- The user supplied it. Best case: real, verifiable, no search. ---- */
  if (mode === 'paste') {
    if (!pastedText?.trim()) throw new Error('Paste the job description text first.');
    const { jd, meta } = await structure({
      sourceText: pastedText,
      company,
      role,
      origin: 'text pasted by the candidate',
    });
    return {
      jd,
      origin: ORIGIN.PASTED,
      sourceUrl: null,
      sourceText: pastedText,
      candidates: [],
      meta,
    };
  }

  /* ---- Search. ---- */
  if (!company?.trim() && !role?.trim()) {
    throw new Error('Give a company name, a role, or both.');
  }

  const results = await searchJobDescription({ company, role });
  if (results.length === 0) {
    const err = new Error('No job postings found for that company and role. Try pasting the posting instead.');
    err.code = 'NO_RESULTS';
    throw err;
  }

  // Try the top few in order; job boards frequently block, so a miss on the
  // first result is normal rather than an error.
  let page = null;
  let usedUrl = null;
  for (const r of results.slice(0, 3)) {
    const text = await fetchPageText(r.link);
    if (text) {
      page = text;
      usedUrl = r.link;
      break;
    }
  }

  if (page) {
    const { jd, meta } = await structure({
      sourceText: page,
      company,
      role,
      origin: `job posting fetched from ${usedUrl}`,
    });
    return {
      jd,
      origin: ORIGIN.FETCHED,
      sourceUrl: usedUrl,
      sourceText: page,
      candidates: results,
      meta,
    };
  }

  // Every page blocked us. Fall back to snippets — thin, and labelled as such
  // so the UI can tell the user this is fragments rather than a posting.
  const snippetText = results
    .map((r) => `${r.title}\n${r.snippet}\n(${r.link})`)
    .join('\n\n');

  const { jd, meta } = await structure({
    sourceText: snippetText,
    company,
    role,
    origin: 'search result snippets only — the full postings could not be retrieved',
  });

  return {
    jd: { ...jd, confidence: 'thin' },
    origin: ORIGIN.SNIPPETS,
    sourceUrl: results[0]?.link ?? null,
    sourceText: snippetText,
    candidates: results,
    meta,
  };
}

export default handler(async (body) => resolveJd(body));
