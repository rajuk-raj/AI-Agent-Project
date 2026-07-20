import { useState } from 'react';
import * as api from '../lib/api.js';

const ORIGIN_LABEL = {
  pasted: { text: 'you pasted this', cls: 'bg-emerald-50 text-emerald-800' },
  fetched: { text: 'fetched from a live posting', cls: 'bg-emerald-50 text-emerald-800' },
  snippets: { text: 'assembled from search snippets', cls: 'bg-amber-50 text-amber-800' },
};

const CONFIDENCE_NOTE = {
  full_posting: null,
  partial: 'Only part of the posting came through — treat this as approximate.',
  thin: 'This is fragments from search results, not a real posting. Paste the actual job ad for anything you rely on.',
};

/**
 * Target-role panel: find a JD by company + role, or paste one.
 *
 * Provenance is always visible. A JD assembled from search snippets is a
 * different artefact from a posting the user pasted, and showing them
 * identically would misrepresent how much the tailoring can be trusted.
 */
export default function JdPanel({ jd, onChange }) {
  const [company, setCompany] = useState(jd?.company ?? '');
  const [role, setRole] = useState(jd?.role ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [open, setOpen] = useState(false);

  async function search() {
    if (!company.trim() && !role.trim()) return setError('Enter a company, a role, or both.');
    setBusy(true);
    setError('');
    try {
      const res = await api.resolveJd({ mode: 'search', company, role });
      onChange({ ...res, company, role });
      setOpen(true);
    } catch (e) {
      setError(
        e.message.includes('SERPER_API_KEY')
          ? 'No search key configured. Add SERPER_API_KEY to .env.local, or paste the posting below.'
          : e.message
      );
    } finally {
      setBusy(false);
    }
  }

  async function usePasted() {
    if (!pasteText.trim()) return setError('Paste the job description first.');
    setBusy(true);
    setError('');
    try {
      const res = await api.resolveJd({ mode: 'paste', company, role, pastedText: pasteText });
      onChange({ ...res, company, role });
      setPasting(false);
      setPasteText('');
      setOpen(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const origin = jd && ORIGIN_LABEL[jd.origin];
  const confidenceNote = jd && CONFIDENCE_NOTE[jd.jd?.confidence];

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Target role <span className="font-normal text-slate-400">optional</span></h3>
        {jd && (
          <button className="text-xs text-slate-500 underline hover:text-slate-900" onClick={() => setOpen(!open)}>
            {open ? 'hide' : 'show'} job description
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Give a company and role and I’ll find the posting. Bullets are then written to emphasise what
        that role actually asks for — using your real accomplishments, never the posting’s claims.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          className="field text-sm"
          placeholder="Company (e.g. Razorpay)"
          value={company}
          onChange={(e) => { setCompany(e.target.value); setError(''); }}
          disabled={busy}
        />
        <input
          className="field text-sm"
          placeholder="Role (e.g. Senior Product Manager)"
          value={role}
          onChange={(e) => { setRole(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          disabled={busy}
        />
        <button className="btn-primary shrink-0 px-4 py-2 text-xs" onClick={search} disabled={busy}>
          {busy ? 'Searching…' : 'Find JD'}
        </button>
      </div>

      <button
        className="mt-2 text-xs text-slate-500 underline hover:text-slate-900"
        onClick={() => setPasting(!pasting)}
      >
        {pasting ? 'cancel' : 'or paste the job description yourself'}
      </button>

      {pasting && (
        <div className="mt-2 space-y-2">
          <textarea
            className="field h-32 resize-y font-mono text-xs"
            placeholder="Paste the full job posting here…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button className="btn-ghost" onClick={usePasted} disabled={busy}>
            {busy ? 'Reading…' : 'Use this job description'}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
      )}

      {jd && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {jd.jd.title}
              {jd.jd.company ? ` · ${jd.jd.company}` : ''}
            </span>
            <span className={`rounded px-2 py-0.5 text-[11px] ${origin.cls}`}>{origin.text}</span>
            {jd.sourceUrl && (
              <a
                href={jd.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[11px] text-slate-500 underline"
              >
                view source
              </a>
            )}
            <button
              className="ml-auto text-[11px] text-slate-400 underline hover:text-slate-700"
              onClick={() => onChange(null)}
            >
              remove
            </button>
          </div>

          {confidenceNote && (
            <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">{confidenceNote}</p>
          )}

          {open && (
            <div className="mt-3 space-y-3 text-xs">
              {jd.jd.requirements?.length > 0 && (
                <div>
                  <p className="font-medium text-slate-700">Asks for</p>
                  <ul className="mt-1 ml-4 list-disc text-slate-600">
                    {jd.jd.requirements.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {jd.jd.keywords?.length > 0 && (
                <div>
                  <p className="font-medium text-slate-700">Their vocabulary</p>
                  <p className="mt-1 text-slate-600">{jd.jd.keywords.join(' · ')}</p>
                </div>
              )}
              <p className="text-slate-400">
                Not what you were after? Search again, or paste the real posting — this only affects
                emphasis and wording, never what your bullets claim.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
