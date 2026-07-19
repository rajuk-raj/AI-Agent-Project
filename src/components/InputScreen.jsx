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
        className="field h-40 resize-y font-mono text-xs"
        placeholder="Paste here, or upload a PDF / DOCX / TXT above…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {value && <p className="text-xs text-slate-500">{value.length.toLocaleString()} characters</p>}
    </div>
  );
}

export default function InputScreen({ onRun }) {
  const [resumeText, setResumeText] = useState('');
  const [experienceText, setExperienceText] = useState('');
  const [seniority, setSeniority] = useState('PM');

  const canRun = resumeText.trim().length > 50;

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <h1 className="text-2xl font-semibold tracking-tight">Resume Bullet Optimizer</h1>
      <p className="mt-2 text-sm text-slate-600">
        Upload your resume. The agent finds which PM competencies you’re missing, rewrites the weak
        bullets, and checks its own work — asking you rather than inventing numbers it can’t support.
      </p>

      <div className="card mt-8 space-y-7 p-6">
        <DocInput
          label="Resume"
          required
          hint="The bullets to work on."
          value={resumeText}
          onChange={setResumeText}
        />

        <DocInput
          label="Experience notes"
          hint="Optional, but this is what makes rewrites specific. A rough brain-dump of projects, numbers, and results not yet on your resume — anything here becomes material the agent can legitimately use."
          value={experienceText}
          onChange={setExperienceText}
        />

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">Target level</label>
          <p className="text-xs text-slate-500">Sets which competencies you’re expected to demonstrate.</p>
          <select className="field" value={seniority} onChange={(e) => setSeniority(e.target.value)}>
            {Object.entries(SENIORITY).map(([id, s]) => (
              <option key={id} value={id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {!experienceText.trim() && resumeText.trim() && (
        <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-900">
          Without experience notes, the agent can only use what’s already written on your resume. Bullets
          with no supporting numbers will be parked as questions rather than improved — which is honest,
          but you’ll get fewer rewrites.
        </p>
      )}

      <button
        className="btn-primary mt-6 w-full"
        disabled={!canRun}
        onClick={() => onRun({ resumeText, experienceText, seniority })}
      >
        Optimize my resume
      </button>
      {!canRun && <p className="mt-2 text-center text-xs text-slate-500">Paste or upload a resume to begin.</p>}
    </div>
  );
}
