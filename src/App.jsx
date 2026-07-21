import { useEffect, useState } from 'react';
import SetupScreen from './components/SetupScreen.jsx';
import Workspace from './components/Workspace.jsx';
import { analyzeDocuments } from './lib/workspace.js';
import { loadSession, saveSession, clearSession, hasDocuments } from './lib/session.js';

export default function App() {
  const [session, setSession] = useState(() => loadSession());
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);

  // Persist on every change, so a refresh mid-session loses nothing.
  useEffect(() => saveSession(session), [session]);

  async function handleReady({ resumeText, experienceText, seniority, jd }) {
    setBusy(true);
    setError(null);
    try {
      const analysis = await analyzeDocuments(
        { resumeText, experienceText, seniority },
        { onStage: setStage }
      );
      setSession((s) => ({ ...s, resumeText, experienceText, seniority, jd, analysis, results: {} }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  function handleReset() {
    // Documents change, so the cached analysis and any generated sections no
    // longer describe the same resume. Keeping them would silently mix sources.
    if (!confirm('Change documents? Your rewritten points will be cleared.')) return;
    clearSession();
    setSession(loadSession());
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-14">
        <h2 className="text-lg font-semibold text-red-700">Something went wrong</h2>
        <p className="mt-2 text-sm text-slate-700">{error.message}</p>
        {error.status === 429 && (
          <p className="mt-2 text-sm text-slate-600">
            That’s a rate limit or an exhausted quota — check your usage at platform.openai.com.
          </p>
        )}
        <button className="btn-primary mt-6" onClick={() => setError(null)}>Back</button>
      </div>
    );
  }

  const ready = hasDocuments(session) && session.analysis;
  if (!ready) {
    return <SetupScreen initial={session} onReady={handleReady} busy={busy} stage={stage} />;
  }

  return <Workspace session={session} onSession={setSession} onReset={handleReset} />;
}
