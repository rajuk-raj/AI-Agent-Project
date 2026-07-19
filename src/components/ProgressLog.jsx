import { useEffect, useRef } from 'react';
import { LOG } from '../lib/orchestrator.js';

const STEPS = [
  'Reading resume',
  'Mapping competencies',
  'Rewriting bullets',
  'Preparing questions',
  'Compiling',
];

const STYLE = {
  [LOG.STEP]: 'text-slate-900 font-medium mt-3',
  [LOG.INFO]: 'text-slate-600 pl-4',
  [LOG.GOOD]: 'text-emerald-700 pl-4',
  [LOG.WARN]: 'text-amber-700 pl-4',
  [LOG.BAD]: 'text-red-700 pl-4',
};

const MARK = {
  [LOG.STEP]: '',
  [LOG.INFO]: '  ',
  [LOG.GOOD]: '+ ',
  [LOG.WARN]: '~ ',
  [LOG.BAD]: 'x ',
};

export default function ProgressLog({ lines, step }) {
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [lines.length]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          Step {Math.min(step, STEPS.length)} of {STEPS.length} — {STEPS[step - 1] ?? 'Working'}
        </h2>
        <span className="text-xs text-slate-500">~1–3 min</span>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full bg-slate-900 transition-all duration-500"
          style={{ width: `${(Math.min(step, STEPS.length) / STEPS.length) * 100}%` }}
        />
      </div>

      <div className="card mt-6 max-h-[28rem] overflow-y-auto p-5">
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} className={STYLE[l.kind] ?? 'text-slate-600'}>
              {MARK[l.kind] ?? ''}{l.text}
            </div>
          ))}
          <div ref={endRef} />
        </pre>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        The agent works alone here — you can’t intervene. Retries and refusals below are it
        checking its own output, not errors.
      </p>
    </div>
  );
}
