import { useState } from 'react';
import { VERDICT } from '../lib/workspace.js';
import { competencyLabel } from '../../shared/competencyModel.js';

const BADGE = {
  [VERDICT.GOOD]: { text: 'checked', cls: 'bg-emerald-50 text-emerald-800' },
  [VERDICT.WEAK]: { text: 'weak', cls: 'bg-amber-50 text-amber-800' },
  [VERDICT.NEEDS_DATA]: { text: 'needs a number', cls: 'bg-amber-50 text-amber-800' },
  [VERDICT.REFUSED]: { text: 'dropped', cls: 'bg-red-50 text-red-800' },
};

const QUICK = [
  { label: 'Shorter', instruction: 'Make this noticeably shorter without losing the result.' },
  { label: 'More specific', instruction: 'Make this more specific using detail already in the source documents.' },
  { label: 'Different angle', instruction: 'Rewrite from a different angle, leading with a different aspect of the work.' },
];

export default function BulletCard({ bullet, onChange, onRemove, onRefine, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bullet.text);
  const [instruction, setInstruction] = useState('');
  const [showAsk, setShowAsk] = useState(false);
  const [showWorking, setShowWorking] = useState(false);

  const badge = BADGE[bullet.verdict] ?? { text: 'checking…', cls: 'bg-slate-100 text-slate-600' };
  const tooLong = bullet.format && !bullet.format.pass;

  function saveEdit() {
    onChange({ ...bullet, text: draft.trim(), edited: true });
    setEditing(false);
  }

  function ask(instr) {
    setShowAsk(false);
    setInstruction('');
    onRefine(instr);
  }

  return (
    <div className={`card p-4 ${bullet.dropped ? 'border-red-200 bg-red-50/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
          {bullet.checking ? 'checking…' : badge.text}
        </span>
        <span className="text-[11px] text-slate-400">{competencyLabel(bullet.competency)}</span>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <textarea
            className="field h-20 resize-y text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={saveEdit}>Save</button>
            <button className="btn-ghost" onClick={() => { setDraft(bullet.text); setEditing(false); }}>
              Cancel
            </button>
            <span className={`ml-auto text-xs tabular-nums ${draft.length > 150 ? 'text-red-600' : 'text-slate-400'}`}>
              {draft.length}/150
            </span>
          </div>
        </div>
      ) : (
        <p className={`mt-2 text-sm ${bullet.dropped ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
          {bullet.text}
        </p>
      )}

      {bullet.basedOn && (
        <p className="mt-2 text-xs text-slate-400">
          reworked from: <span className="italic">“{bullet.basedOn}”</span>
        </p>
      )}

      {bullet.note && (
        <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-700">{bullet.note}</p>
      )}

      {tooLong && !editing && (
        <p className="mt-2 text-xs text-amber-700">{bullet.format.issues[0]}</p>
      )}

      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button className="btn-ghost" onClick={() => setEditing(true)} disabled={busy}>Edit</button>
          {QUICK.map((q) => (
            <button key={q.label} className="btn-ghost" onClick={() => ask(q.instruction)} disabled={busy}>
              {q.label}
            </button>
          ))}
          <button className="btn-ghost" onClick={() => setShowAsk(!showAsk)} disabled={busy}>
            Tell it what to change
          </button>
          <button className="btn-ghost ml-auto text-slate-400" onClick={onRemove} disabled={busy}>
            Remove
          </button>
        </div>
      )}

      {showAsk && (
        <div className="mt-2 flex gap-2">
          <input
            className="field text-sm"
            placeholder="e.g. mention the team size, or lead with the migration"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && instruction.trim() && ask(instruction)}
            autoFocus
          />
          <button className="btn-primary shrink-0 px-4 py-1.5 text-xs" onClick={() => instruction.trim() && ask(instruction)}>
            Apply
          </button>
        </div>
      )}

      {(bullet.score != null || bullet.claimsUsed?.length > 0) && !editing && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <button
            className="text-[11px] text-slate-400 hover:text-slate-700"
            onClick={() => setShowWorking(!showWorking)}
          >
            {showWorking ? 'hide working' : `working${bullet.attempts > 1 ? ` · ${bullet.attempts} attempts` : ''}`}
            {bullet.score != null && ` · ${bullet.score}%`}
          </button>

          {showWorking && (
            <div className="mt-2 space-y-1.5 text-[11px] text-slate-500">
              {bullet.scores && (
                <p>
                  competency {bullet.scores.competency} · STAR {bullet.scores.star} · specificity{' '}
                  {bullet.scores.specificity} · format {bullet.scores.format}
                </p>
              )}
              {bullet.claimsUsed?.length > 0 && (
                <div>
                  <p className="text-slate-400">grounded in:</p>
                  <ul className="ml-3 list-disc">
                    {bullet.claimsUsed.map((c, i) => <li key={i}>“{c}”</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
