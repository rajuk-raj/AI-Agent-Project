import { useState } from 'react';
import { competencyLabel } from '../../shared/competencyModel.js';

/**
 * The agent asking which heading to work on.
 *
 * Lists what it actually found in both documents rather than leaving the user
 * to guess what to type. Free text stays available for anything not listed.
 */
export default function SectionPicker({ analysis, worked = {}, source, onPick, onPickCustom }) {
  const [custom, setCustom] = useState('');

  // A session saved under an older shape has no sections. Fail visibly with a
  // way forward rather than crashing the whole screen.
  const all = analysis?.sections ?? [];
  if (all.length === 0) {
    return (
      <div className="card p-6">
        <p className="text-sm font-medium">No sections found in your documents.</p>
        <p className="mt-2 text-xs text-slate-600">
          This usually means the resume text came through without recognisable headings or bullet
          points. Use “Change documents” above and paste the text directly.
        </p>
      </div>
    );
  }

  // Which document's sections are on screen is chosen by the tabs above this
  // component, so only one group renders at a time.
  const shown = all.filter((s) => s.source === source);

  // Group by the heading each section sits under, so "Certification &
  // Training" holding two programmes reads the way it does on the resume
  // rather than as two unrelated entries.
  const groups = shown.reduce((acc, s) => {
    const key = s.parentHeading ?? '';
    (acc[key] ??= []).push(s);
    return acc;
  }, {});

  const Group = ({ sections, hint }) =>
    sections.length === 0 ? null : (
      <div>
        <p className="text-xs text-slate-400">{hint}</p>
        <div className="mt-2 space-y-2">
          {sections.map((s) => {
            const done = worked[s.id];
            return (
              <button
                key={s.id}
                onClick={() => onPick(s)}
                className="card w-full p-4 text-left transition hover:border-slate-400"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-slate-900">
                    {s.heading}
                    {s.kind === 'list' && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
                        list
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {done ? `${done} improved` : `${s.points.length} point${s.points.length > 1 ? 's' : ''}`}
                  </span>
                </div>
                {s.context && <p className="mt-0.5 text-xs text-slate-500">{s.context}</p>}
                <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                  {s.points[0].text}
                  {s.points.length > 1 && ` · +${s.points.length - 1} more`}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="card border-slate-300 bg-white p-5">
        <p className="text-sm font-medium text-slate-900">Which heading do you want to work on?</p>
        <p className="mt-1 text-xs text-slate-500">
          I found these in your documents. Pick one and I’ll rewrite each point under it, showing you
          the original beside the improvement.
        </p>

        {analysis.coverage?.gapIds?.length > 0 && (
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Your resume currently shows nothing for{' '}
            <strong>{analysis.coverage.gapIds.map(competencyLabel).join(', ')}</strong>. I’ll aim
            rewrites there where your material supports it.
          </p>
        )}
      </div>

      {Object.entries(groups).map(([parent, sections]) => (
        <div key={parent || '_top'} className="space-y-2">
          {parent && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {parent}
            </h3>
          )}
          <Group
            sections={sections}
            hint={
              parent
                ? ''
                : source === 'resume'
                ? 'Points already on your resume — rewritten in place.'
                : 'Work you’ve written down but not yet put on your resume.'
            }
          />
        </div>
      ))}

      {shown.length === 0 && (
        <p className="card p-4 text-xs text-slate-500">
          {source === 'resume'
            ? 'No headings were found in the resume itself.'
            : 'No experience notes yet. Add them under “Change documents” — they’re where most new material comes from.'}
        </p>
      )}

      <div className="card p-4">
        <label className="text-xs font-medium text-slate-700">Or describe a section yourself</label>
        <div className="mt-2 flex gap-2">
          <input
            className="field text-sm"
            placeholder="e.g. the payments retry work"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && custom.trim() && onPickCustom(custom.trim())}
          />
          <button
            className="btn-ghost shrink-0"
            onClick={() => custom.trim() && onPickCustom(custom.trim())}
          >
            Find it
          </button>
        </div>
      </div>
    </div>
  );
}
