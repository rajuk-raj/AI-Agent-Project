import { useEffect, useState } from 'react';
import InputScreen from './components/InputScreen.jsx';
import ProgressLog from './components/ProgressLog.jsx';
import OutputScreen from './components/OutputScreen.jsx';
import { runAgent } from './lib/orchestrator.js';

const PHASE = { INPUT: 'input', RUNNING: 'running', DONE: 'done', ERROR: 'error' };

export default function App() {
  const [phase, setPhase] = useState(PHASE.INPUT);
  const [lines, setLines] = useState([]);
  const [step, setStep] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Run state lives in memory (see orchestrator.js), so a refresh loses it.
  useEffect(() => {
    if (phase !== PHASE.RUNNING) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  async function handleRun(input) {
    setPhase(PHASE.RUNNING);
    setLines([]);
    setStep(1);
    setError(null);
    try {
      const res = await runAgent(input, {
        onLog: (line) => setLines((prev) => [...prev, line]),
        onStep: setStep,
      });
      setResult(res);
      setPhase(PHASE.DONE);
    } catch (err) {
      setError(err);
      setPhase(PHASE.ERROR);
    }
  }

  if (phase === PHASE.INPUT) return <InputScreen onRun={handleRun} />;
  if (phase === PHASE.RUNNING) return <ProgressLog lines={lines} step={step} />;
  if (phase === PHASE.DONE) return <OutputScreen result={result} onRestart={() => setPhase(PHASE.INPUT)} />;

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <h2 className="text-lg font-semibold text-red-700">The run failed</h2>
      <p className="mt-2 text-sm text-slate-700">{error?.message}</p>
      {error?.status === 429 && (
        <p className="mt-2 text-sm text-slate-600">
          That’s a rate limit or an exhausted quota. Check your usage at platform.openai.com.
        </p>
      )}
      <div className="card mt-6 max-h-72 overflow-y-auto p-4">
        <pre className="whitespace-pre-wrap font-mono text-xs text-slate-600">
          {lines.map((l, i) => <div key={i}>{l.text}</div>)}
        </pre>
      </div>
      <button className="btn-primary mt-6" onClick={() => setPhase(PHASE.INPUT)}>Back</button>
    </div>
  );
}
