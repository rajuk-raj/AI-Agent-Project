import { useEffect, useRef, useState } from 'react';
import { LOG, BULLET_STATE } from '../lib/orchestrator.js';

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

const BULLET_STYLE = {
  [BULLET_STATE.QUEUED]: { dot: 'bg-slate-300', label: 'waiting', text: 'text-slate-400' },
  [BULLET_STATE.WORKING]: { dot: 'bg-blue-500 animate-pulse', label: 'working', text: 'text-slate-900' },
  [BULLET_STATE.ACCEPTED]: { dot: 'bg-emerald-500', label: 'improved', text: 'text-slate-700' },
  [BULLET_STATE.ASKING]: { dot: 'bg-amber-500', label: 'needs your input', text: 'text-slate-700' },
  [BULLET_STATE.FLAGGED]: { dot: 'bg-red-500', label: 'flagged', text: 'text-slate-700' },
};

/** Wall-clock timer, so a long step never looks like a hang. */
function useElapsed() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return secs;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function StepRail({ step }) {
  return (
    <ol className="mt-5 space-y-2">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <li key={label} className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                done
                  ? 'bg-emerald-500 text-white'
                  : active
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              {done ? '✓' : n}
            </span>
            <span className={done ? 'text-slate-500' : active ? 'font-medium text-slate-900' : 'text-slate-400'}>
              {label}
            </span>
            {active && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-slate-900" />}
          </li>
        );
      })}
    </ol>
  );
}

function BulletBoard({ bullets }) {
  if (!bullets.length) return null;

  const done = bullets.filter((b) => b.state !== BULLET_STATE.QUEUED && b.state !== BULLET_STATE.WORKING).length;

  return (
    <div className="card mt-6 p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Bullets being rewritten</h3>
        <span className="text-xs tabular-nums text-slate-500">{done} of {bullets.length} done</span>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${(done / bullets.length) * 100}%` }}
        />
      </div>

      <ul className="mt-4 space-y-2.5">
        {bullets.map((b) => {
          const s = BULLET_STYLE[b.state];
          return (
            <li key={b.id} className="flex items-start gap-3 text-xs">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
              <span className={`flex-1 ${s.text}`}>
                {b.text.length > 62 ? `${b.text.slice(0, 62)}…` : b.text}
                {b.target && b.state === BULLET_STATE.WORKING && (
                  <span className="mt-0.5 block text-slate-400">aiming for {b.target}</span>
                )}
              </span>
              <span className="shrink-0 text-right text-slate-500">
                <span>{s.label}</span>
                {b.attempts > 1 && (
                  <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                    try {b.attempts}
                  </span>
                )}
                {b.score != null && <span className="ml-1.5 tabular-nums">{b.score}%</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ProgressLog({ lines, step, bullets = [], activity }) {
  const endRef = useRef(null);
  const elapsed = useElapsed();
  const [showLog, setShowLog] = useState(true);

  useEffect(() => {
    if (showLog) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length, showLog]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">The agent is working</h2>
        <span className="font-mono text-xs tabular-nums text-slate-500">{mmss(elapsed)}</span>
      </div>

      {/* Always says what is happening right now — the antidote to a blank wait. */}
      <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
        {activity ?? 'Starting…'}
      </p>

      <StepRail step={step} />

      <BulletBoard bullets={bullets} />

      <div className="mt-6">
        <button
          className="flex w-full items-center justify-between text-xs font-medium text-slate-600 hover:text-slate-900"
          onClick={() => setShowLog(!showLog)}
        >
          <span>Detailed log ({lines.length} lines)</span>
          <span>{showLog ? 'hide' : 'show'}</span>
        </button>

        {showLog && (
          <div className="card mt-2 max-h-72 overflow-y-auto p-4">
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
              {lines.map((l, i) => (
                <div key={i} className={STYLE[l.kind] ?? 'text-slate-600'}>
                  {MARK[l.kind] ?? ''}{l.text}
                </div>
              ))}
              <div ref={endRef} />
            </pre>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Retries and refusals are the agent checking its own work, not errors. A bullet that retries
        three times is one it couldn’t improve honestly on the first pass.
      </p>
    </div>
  );
}
