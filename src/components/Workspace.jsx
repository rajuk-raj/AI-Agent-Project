import { useState } from 'react';
import BulletCard from './BulletCard.jsx';
import { generateSection, refineBullet } from '../lib/workspace.js';
import { competencyLabel, SENIORITY } from '../../shared/competencyModel.js';

const SUGGESTIONS = [
  'Bullets for my most recent role',
  'Bullets showing cross-functional influence',
  'Bullets about the metrics work I did',
  'A projects section',
];

function CoverageBar({ analysis }) {
  const [open, setOpen] = useState(false);
  if (!analysis) return null;
  const { coverage } = analysis;

  return (
    <div className="card p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span className="text-sm">
          <span className="font-semibold">{coverage.display}</span>{' '}
          <span className="text-slate-500">competencies covered</span>
          {coverage.gapIds.length > 0 && (
            <span className="ml-2 text-amber-700">
              missing: {coverage.gapIds.map(competencyLabel).join(', ')}
            </span>
          )}
        </span>
        <span className="text-xs text-slate-400">{open ? 'hide' : 'details'}</span>
      </button>

      {open && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">
          {Object.entries(coverage.byCompetency).map(([id, c]) => (
            <li key={id} className="flex items-center gap-2">
              <span className="w-52 text-slate-700">{competencyLabel(id)}</span>
              <span className="flex gap-0.5">
                {c.strong > 0
                  ? Array.from({ length: c.strong }).map((_, i) => (
                      <span key={i} className="h-2 w-2 rounded-sm bg-slate-700" />
                    ))
                  : <span className="h-2 w-2 rounded-sm bg-slate-200" />}
              </span>
              {coverage.gapIds.includes(id) && <span className="text-amber-700">gap</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-slate-400">
        Based on your uploaded resume. The agent aims new bullets at the gaps where your source
        material genuinely supports it.
      </p>
    </div>
  );
}

function Section({ section, session, onUpdate, onDelete }) {
  const [busyId, setBusyId] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [editingHeading, setEditingHeading] = useState(false);

  const update = (patch) => onUpdate({ ...section, ...patch });

  const setBullet = (next) =>
    update({ bullets: section.bullets.map((b) => (b.id === next.id ? next : b)) });

  async function handleRefine(bullet, instruction) {
    setBusyId(bullet.id);
    setRefusal(null);
    try {
      const res = await refineBullet(session, {
        bullet,
        instruction,
        siblings: section.bullets.map((b) => b.text),
      });
      if (res.refused) setRefusal({ id: bullet.id, text: res.refused });
      else setBullet(res.bullet);
    } catch (e) {
      setRefusal({ id: bullet.id, text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  const kept = section.bullets.filter((b) => !b.dropped);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {editingHeading ? (
          <input
            className="field text-sm font-semibold"
            value={section.heading}
            onChange={(e) => update({ heading: e.target.value })}
            onBlur={() => setEditingHeading(false)}
            onKeyDown={(e) => e.key === 'Enter' && setEditingHeading(false)}
            autoFocus
          />
        ) : (
          <h3
            className="cursor-text text-base font-semibold hover:text-slate-600"
            onClick={() => setEditingHeading(true)}
            title="Click to rename"
          >
            {section.heading}
          </h3>
        )}
        <span className="text-xs text-slate-400">{kept.length} bullets</span>
        <button className="btn-ghost ml-auto text-slate-400" onClick={onDelete}>Delete section</button>
      </div>

      <p className="text-xs italic text-slate-400">you asked: “{section.request}”</p>

      {section.unsupported?.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p className="font-medium">Couldn’t support everything you asked for:</p>
          <ul className="mt-1 ml-4 list-disc">
            {section.unsupported.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
          <p className="mt-1.5">Add these facts to your experience notes and generate again.</p>
        </div>
      )}

      {section.bullets.map((b) => (
        <div key={b.id}>
          <BulletCard
            bullet={b}
            busy={busyId === b.id}
            onChange={setBullet}
            onRemove={() => update({ bullets: section.bullets.filter((x) => x.id !== b.id) })}
            onRefine={(instr) => handleRefine(b, instr)}
          />
          {refusal?.id === b.id && (
            <p className="mt-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <strong>The agent declined:</strong> {refusal.text}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Workspace({ session, onSession, onReset }) {
  const [request, setRequest] = useState('');
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null); // section being generated
  const [error, setError] = useState('');

  async function handleGenerate(text) {
    const req = (text ?? request).trim();
    if (!req) return setError('Tell the agent what to write about.');

    setBusy(true);
    setError('');
    setDraft(null);
    try {
      const res = await generateSection(session, req, {
        onStage: setStage,
        onBullets: (bullets) => setDraft((d) => ({ ...(d ?? { heading: '…', request: req }), bullets })),
      });
      const section = {
        id: `s${Date.now().toString(36)}`,
        request: req,
        heading: res.section.heading,
        unsupported: res.section.unsupported,
        bullets: res.bullets,
      };
      onSession({ ...session, sections: [...session.sections, section] });
      setDraft(null);
      setRequest('');
    } catch (e) {
      setError(e.message);
      setDraft(null);
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  const updateSection = (next) =>
    onSession({ ...session, sections: session.sections.map((s) => (s.id === next.id ? next : s)) });

  const deleteSection = (id) =>
    onSession({ ...session, sections: session.sections.filter((s) => s.id !== id) });

  function copyAll() {
    const text = session.sections
      .map((s) => `${s.heading}\n${s.bullets.filter((b) => !b.dropped).map((b) => `- ${b.text}`).join('\n')}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
  }

  const totalBullets = session.sections.reduce((n, s) => n + s.bullets.filter((b) => !b.dropped).length, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Resume Bullet Optimizer</h1>
          <p className="text-xs text-slate-500">
            {SENIORITY[session.seniority]?.label} · resume loaded
            {session.experienceText ? ' · experience notes loaded' : ' · no experience notes'}
          </p>
        </div>
        <button className="btn-ghost" onClick={onReset}>Change documents</button>
      </div>

      <CoverageBar analysis={session.analysis} />

      {/* Request box */}
      <div className="card p-5">
        <label className="text-sm font-medium">What should the agent write bullets for?</label>
        <textarea
          className="field mt-2 h-20 resize-y text-sm"
          placeholder="e.g. bullets for my Pine Labs role focused on the onboarding work"
          value={request}
          onChange={(e) => { setRequest(e.target.value); setError(''); }}
          disabled={busy}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn-ghost" onClick={() => setRequest(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        <button className="btn-primary mt-3 w-full" onClick={() => handleGenerate()} disabled={busy}>
          {busy ? 'Working…' : 'Generate bullets'}
        </button>
        {busy && (
          <p className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
            {stage}
          </p>
        )}
      </div>

      {/* Live draft while generating */}
      {draft?.bullets && (
        <div className="space-y-3 opacity-90">
          <h3 className="text-base font-semibold text-slate-500">Drafting…</h3>
          {draft.bullets.map((b) => (
            <div key={b.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  {b.checking ? 'checking…' : b.verdict === 'refused' ? 'dropped' : 'checked'}
                </span>
                {b.score != null && <span className="text-[11px] tabular-nums text-slate-400">{b.score}%</span>}
              </div>
              <p className={`mt-2 text-sm ${b.dropped ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                {b.text}
              </p>
              {b.note && <p className="mt-1.5 text-xs text-slate-500">{b.note}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Accepted sections */}
      {session.sections.map((s) => (
        <Section
          key={s.id}
          section={s}
          session={session}
          onUpdate={updateSection}
          onDelete={() => deleteSection(s.id)}
        />
      ))}

      {session.sections.length > 0 && (
        <div className="flex items-center gap-3 border-t border-slate-200 pt-5">
          <button className="btn-primary" onClick={copyAll}>Copy all ({totalBullets} bullets)</button>
          <span className="text-xs text-slate-400">
            {session.sections.length} section{session.sections.length > 1 ? 's' : ''} · saved in this browser
          </span>
        </div>
      )}

      {session.sections.length === 0 && !busy && (
        <p className="py-8 text-center text-sm text-slate-400">
          Ask for your first set of bullets above. Work through one section at a time.
        </p>
      )}
    </div>
  );
}
