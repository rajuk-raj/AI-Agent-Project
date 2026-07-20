import { useState } from 'react';
import { parseFile, ACCEPTED } from '../lib/parse.js';
import { SENIORITY } from '../../shared/competencyModel.js';

function DocInput({ label, hint, value, onChange, required }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      onChange(await parseFile(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-medium text-slate-900">
          {label} {required && <span className="text-red-600">*</span>}
        </label>
        <label className="cursor-pointer text-xs font-medium text-slate-600 underline hover:text-slate-900">
          {busy ? 'reading…' : 'upload a file'}
          <input type="file" accept={ACCEPTED} onChange={handleFile} className="hidden" disabled={busy} />
        </label>
      </div>
      <p className="text-xs text-slate-500">{hint}</p>
      <textarea
        className="field h-36 resize-y font-mono text-xs"
        placeholder="Paste here, or upload a PDF / DOCX / TXT above…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Couldn’t read that file: {error}
        </p>
      )}
      {value && <p className="text-xs text-slate-500">{value.length.toLocaleString()} characters</p>}
    </div>
  );
}

export default function SetupScreen({ initial, onReady, busy, stage }) {
  const [resumeText, setResumeText] = useState(initial?.resumeText ?? '');
  const [experienceText, setExperienceText] = useState(initial?.experienceText ?? '');
  const [seniority, setSeniority] = useState(initial?.seniority ?? 'PM');
  const [problem, setProblem] = useState('');

  function handleClick() {
    const resume = resumeText.trim();
    if (!resume) return setProblem('Add your resume first — paste the text above, or use “upload a file”.');
    if (resume.length < 50)
      return setProblem(`That’s only ${resume.length} characters. Paste your full resume, or at least a few bullet points.`);
    setProblem('');
    onReady({ resumeText, experienceText, seniority });
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <h1 className="text-2xl font-semibold tracking-tight">Resume Bullet Optimizer</h1>
      <p className="mt-2 text-sm text-slate-600">
        Give the agent your documents once. After that you tell it what to write about, section by
        section, and refine what it produces.
      </p>

      <div className="card mt-8 space-y-7 p-6">
        <DocInput
          label="Resume"
          required
          hint="Used as source material, and to avoid repeating what’s already there."
          value={resumeText}
          onChange={(v) => {
            setResumeText(v);
            setProblem('');
          }}
        />

        <DocInput
          label="Experience notes"
          hint="Optional but important. A rough brain-dump — projects, numbers, results, things not yet on your resume. This is what the agent can legitimately draw on; without it, it can only reshuffle what you already wrote."
          value={experienceText}
          onChange={setExperienceText}
        />

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">Target level</label>
          <select className="field" value={seniority} onChange={(e) => setSeniority(e.target.value)}>
            {Object.entries(SENIORITY).map(([id, s]) => (
              <option key={id} value={id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {problem && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{problem}</p>
      )}

      <button className="btn-primary mt-6 w-full" onClick={handleClick} disabled={busy}>
        {busy ? 'Reading your documents…' : 'Continue'}
      </button>

      <p className="mt-2 text-center text-xs text-slate-500">
        {busy ? stage : 'One-off analysis takes ~20 seconds. Your documents are then reused for the whole session.'}
      </p>

      <p className="mt-6 text-center text-xs text-slate-400">
        Your documents stay in this browser and are sent only to the model. Nothing is stored on a server.
      </p>
    </div>
  );
}
