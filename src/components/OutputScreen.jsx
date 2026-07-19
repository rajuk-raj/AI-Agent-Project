import { useState } from 'react';
import {
  COMPETENCIES,
  competencyLabel,
  computeCoverage,
  STRENGTH,
} from '../../shared/competencyModel.js';
import { OUTCOME } from '../../shared/optimizeLoop.js';

function Coverage({ before, after }) {
  return (
    <div className="card p-6">
      <div className="flex items-baseline gap-3">
        <h3 className="text-sm font-semibold">Competency coverage</h3>
        <span className="text-xs text-slate-500">
          competencies with at least one bullet that states an outcome
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <span className="text-3xl font-semibold tabular-nums text-slate-400">{before.display}</span>
        <span className="text-slate-400">→</span>
        <span className="text-3xl font-semibold tabular-nums text-emerald-700">{after.display}</span>
      </div>

      <div className="mt-5 space-y-1.5">
        {COMPETENCIES.map((c) => {
          const b = before.byCompetency[c.id];
          const a = after.byCompetency[c.id];
          const gained = a.strong > b.strong;
          const gap = after.gapIds.includes(c.id);
          return (
            <div key={c.id} className="flex items-center gap-3 text-xs">
              <span className="w-56 shrink-0 text-slate-700">{c.label}</span>
              <span className="flex gap-0.5">
                {Array.from({ length: Math.max(a.strong, 1) }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-2.5 w-2.5 rounded-sm ${
                      a.strong === 0 ? 'bg-slate-200' : i < b.strong ? 'bg-slate-700' : 'bg-emerald-500'
                    }`}
                  />
                ))}
              </span>
              {gained && <span className="text-emerald-700">improved</span>}
              {gap && <span className="text-amber-700">still missing</span>}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Computed the same way before and after, so the change is real. This is not an “ATS score” —
        no applicant tracking system works this way.
      </p>
    </div>
  );
}

function BulletCard({ result }) {
  const [kept, setKept] = useState(true);
  const accepted = result.outcome === OUTCOME.ACCEPTED;
  const [showWorking, setShowWorking] = useState(false);

  const badge = accepted
    ? { text: 'Improved', cls: 'bg-emerald-50 text-emerald-800' }
    : result.outcome === OUTCOME.NEEDS_CLARIFICATION
    ? { text: 'Needs your input', cls: 'bg-amber-50 text-amber-800' }
    : { text: 'Flagged — review by hand', cls: 'bg-red-50 text-red-800' };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.text}</span>
        <span className="text-xs text-slate-400">{competencyLabel(result.target)}</span>
      </div>

      <p className="mt-3 text-sm text-slate-500 line-through decoration-slate-300">{result.original}</p>

      {accepted && (
        <p className={`mt-2 text-sm ${kept ? 'font-medium text-slate-900' : 'text-slate-400'}`}>
          {result.best.rewrite}
        </p>
      )}

      {!accepted && result.best && (
        <p className="mt-2 text-sm italic text-slate-500">
          Best attempt: “{result.best.rewrite}” — not presented as an improvement.
        </p>
      )}

      {result.fabricatedClaims?.length > 0 && (
        <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-800">
          The agent refused this because it would have meant asserting{' '}
          <strong>“{result.fabricatedClaims[0]}”</strong>, which isn’t in your documents.
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        {accepted && (
          <>
            <button className="btn-ghost" onClick={() => setKept(!kept)}>
              {kept ? 'Revert to original' : 'Keep improved'}
            </button>
            <span className="text-xs tabular-nums text-slate-500">{result.best.composite}%</span>
          </>
        )}
        <button className="btn-ghost ml-auto" onClick={() => setShowWorking(!showWorking)}>
          {showWorking ? 'Hide working' : `Show working (${result.attempts.length} attempt${result.attempts.length > 1 ? 's' : ''})`}
        </button>
      </div>

      {showWorking && (
        <ol className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {result.attempts.map((a) => (
            <li key={a.attempt} className="text-xs">
              <span className="font-mono text-slate-400">#{a.attempt + 1}</span>{' '}
              <span className="tabular-nums text-slate-700">{a.composite}%</span>{' '}
              <span className="text-slate-500">{a.reason}</span>
              <p className="mt-0.5 pl-6 text-slate-500">“{a.rewrite}”</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function OutputScreen({ result, onRestart }) {
  const { results, questions, coverageBefore, afterBullets, seniority, usage } = result;
  const coverageAfter = computeCoverage(afterBullets, seniority);

  const improved = results.filter((r) => r.outcome === OUTCOME.ACCEPTED);
  const parked = results.filter((r) => r.outcome === OUTCOME.NEEDS_CLARIFICATION);
  const flagged = results.filter((r) => r.outcome === OUTCOME.FLAGGED);

  const copyAll = () => {
    const text = results
      .map((r) => (r.outcome === OUTCOME.ACCEPTED ? `- ${r.best.rewrite}` : `- ${r.original}`))
      .join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Results</h2>
        <button className="btn-ghost" onClick={onRestart}>Start over</button>
      </div>

      <Coverage before={coverageBefore} after={coverageAfter} />

      {questions.length > 0 && (
        <div className="card border-amber-200 bg-amber-50/50 p-6">
          <h3 className="text-sm font-semibold">
            {questions.length} question{questions.length > 1 ? 's' : ''} the agent couldn’t answer for you
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            These bullets have no numbers anywhere in your documents. Rather than invent something
            plausible, the agent stopped and asked.
          </p>
          <ul className="mt-4 space-y-3">
            {questions.map((q, i) => (
              <li key={i} className="text-sm">
                <p className="text-slate-900">{q.question}</p>
                <p className="mt-0.5 text-xs text-slate-500">{q.whatItUnlocks}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Answering these and re-running is the single biggest improvement available to you.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">
          {improved.length} improved · {parked.length} need input · {flagged.length} flagged
        </h3>
        {results.map((r) => <BulletCard key={r.id} result={r} />)}
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={copyAll}>Copy all bullets</button>
        <span className="ml-auto text-xs text-slate-400">
          {usage.calls} model calls · {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens
        </span>
      </div>
    </div>
  );
}
