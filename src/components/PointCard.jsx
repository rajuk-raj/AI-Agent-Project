import { useState } from 'react';
import { POINT } from '../lib/workspace.js';

const BADGE = {
  [POINT.PENDING]: { text: 'waiting', cls: 'bg-slate-100 text-slate-500' },
  [POINT.WORKING]: { text: 'rewriting…', cls: 'bg-blue-50 text-blue-700' },
  [POINT.IMPROVED]: { text: 'improved', cls: 'bg-emerald-50 text-emerald-800' },
  [POINT.NEEDS_DATA]: { text: 'needs a number from you', cls: 'bg-amber-50 text-amber-800' },
  [POINT.REFUSED]: { text: 'left as-is', cls: 'bg-red-50 text-red-800' },
  [POINT.UNCHANGED]: { text: 'left as-is', cls: 'bg-slate-100 text-slate-600' },
};

/**
 * One point, one box: the original above, the rewrite below, and a regenerate
 * button scoped to this point alone.
 */
export default function PointCard({ point, index, busy, onRegenerate, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(point.rewrite ?? '');
  const [showWorking, setShowWorking] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [asking, setAsking] = useState(false);

  const badge = BADGE[point.state] ?? BADGE[POINT.PENDING];
  const hasRewrite = Boolean(point.rewrite);
  const working = point.state === POINT.WORKING;

  function save() {
    onEdit(draft.trim());
    setEditing(false);
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2">
        <span className="text-xs font-medium text-slate-500">Point {index + 1}</span>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
          {badge.text}
          {point.attempts > 1 && point.state === POINT.IMPROVED && ` · ${point.attempts} attempts`}
        </span>
      </div>

      <div className="space-y-3 p-4">
        {/* Original — always visible, so the comparison is the point of the UI. */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Your original</p>
          <p className="mt-1 text-sm text-slate-500">{point.text}</p>
        </div>

        {working && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
            Rewriting and checking against your documents…
          </div>
        )}

        {hasRewrite && !working && (
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Rewritten</p>
              {point.score != null && (
                <span className="text-[11px] tabular-nums text-slate-400">{point.score}%</span>
              )}
            </div>

            {editing ? (
              <div className="mt-1 space-y-2">
                <textarea
                  className="field h-20 resize-y text-sm"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button className="btn-ghost" onClick={save}>Save</button>
                  <button className="btn-ghost" onClick={() => { setDraft(point.rewrite); setEditing(false); }}>
                    Cancel
                  </button>
                  <span className={`ml-auto text-xs tabular-nums ${draft.length > 150 ? 'text-red-600' : 'text-slate-400'}`}>
                    {draft.length}/150
                  </span>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-sm font-medium text-slate-900">{point.rewrite}</p>
            )}
          </div>
        )}

        {point.note && (
          <p className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-700">{point.note}</p>
        )}

        {!working && point.state !== POINT.PENDING && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button className="btn-ghost" onClick={() => onRegenerate()} disabled={busy}>
              ↻ Regenerate
            </button>
            <button className="btn-ghost" onClick={() => setAsking(!asking)} disabled={busy}>
              Regenerate with a note
            </button>
            {hasRewrite && (
              <button className="btn-ghost" onClick={() => { setDraft(point.rewrite); setEditing(true); }} disabled={busy}>
                Edit
              </button>
            )}
            {(point.score != null || point.claimsUsed?.length > 0) && (
              <button
                className="btn-ghost ml-auto text-slate-400"
                onClick={() => setShowWorking(!showWorking)}
              >
                {showWorking ? 'hide working' : 'working'}
              </button>
            )}
          </div>
        )}

        {asking && (
          <div className="flex gap-2">
            <input
              className="field text-sm"
              placeholder="e.g. lead with the team size, or mention the timeline"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && instruction.trim()) {
                  onRegenerate(instruction.trim());
                  setInstruction('');
                  setAsking(false);
                }
              }}
              autoFocus
            />
            <button
              className="btn-primary shrink-0 px-4 py-1.5 text-xs"
              onClick={() => {
                if (!instruction.trim()) return;
                onRegenerate(instruction.trim());
                setInstruction('');
                setAsking(false);
              }}
            >
              Go
            </button>
          </div>
        )}

        {showWorking && (
          <div className="space-y-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
            {point.scores && (
              <p>
                competency {point.scores.competency} · STAR {point.scores.star} · specificity{' '}
                {point.scores.specificity} · format {point.scores.format}
              </p>
            )}
            {point.claimsUsed?.length > 0 && (
              <div>
                <p className="text-slate-400">facts it used from your documents:</p>
                <ul className="ml-3 list-disc">
                  {point.claimsUsed.map((c, i) => <li key={i}>“{c}”</li>)}
                </ul>
              </div>
            )}
            {point.history?.length > 1 && (
              <div>
                <p className="text-slate-400">earlier versions you regenerated past:</p>
                <ul className="ml-3 list-disc">
                  {point.history.slice(0, -1).map((h, i) => <li key={i}>“{h}”</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
