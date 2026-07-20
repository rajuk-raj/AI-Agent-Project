import { useState } from 'react';
import SectionPicker from './SectionPicker.jsx';
import PointCard from './PointCard.jsx';
import { rewriteSection, rewritePoint, POINT } from '../lib/workspace.js';
import { SENIORITY } from '../../shared/competencyModel.js';

export default function Workspace({ session, onSession, onReset }) {
  const [active, setActive] = useState(null); // { section, points }
  const [busy, setBusy] = useState(false);
  const [busyPoint, setBusyPoint] = useState(null);
  const [error, setError] = useState('');

  const { analysis } = session;

  /** How many points were improved per section, for the picker. */
  const worked = Object.fromEntries(
    Object.entries(session.results ?? {}).map(([id, pts]) => [
      id,
      pts.filter((p) => p.state === POINT.IMPROVED).length,
    ])
  );

  async function openSection(section) {
    setError('');
    setActive({ section, points: section.points.map((p) => ({ ...p, state: POINT.PENDING })) });

    // Already worked on: restore rather than spending calls again.
    const saved = session.results?.[section.id];
    if (saved) {
      setActive({ section, points: saved });
      return;
    }

    setBusy(true);
    try {
      const res = await rewriteSection(session, section, {
        onPoint: (points) => setActive({ section, points }),
      });
      setActive({ section, points: res.points });
      onSession({ ...session, results: { ...(session.results ?? {}), [section.id]: res.points } });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(point, instruction) {
    setBusyPoint(point.id);
    setError('');
    try {
      // Everything already shown for this point is off the table, so a
      // regenerate genuinely changes angle instead of returning the same line.
      const avoid = [point.rewrite, ...(point.history ?? [])].filter(Boolean);
      const next = await rewritePoint(session, {
        point: { ...point, text: point.text },
        avoid: instruction ? [] : avoid,
        instruction,
      });

      const points = active.points.map((p) => (p.id === point.id ? next : p));
      setActive({ ...active, points });
      onSession({
        ...session,
        results: { ...(session.results ?? {}), [active.section.id]: points },
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyPoint(null);
    }
  }

  function editPoint(point, text) {
    const points = active.points.map((p) =>
      p.id === point.id ? { ...p, rewrite: text, edited: true } : p
    );
    setActive({ ...active, points });
    onSession({ ...session, results: { ...(session.results ?? {}), [active.section.id]: points } });
  }

  function copySection() {
    const text = active.points
      .map((p) => `- ${p.rewrite ?? p.text}`)
      .join('\n');
    navigator.clipboard.writeText(`${active.section.heading}\n${text}`);
  }

  const improved = active?.points.filter((p) => p.state === POINT.IMPROVED).length ?? 0;
  const done = active?.points.every((p) => p.state !== POINT.PENDING && p.state !== POINT.WORKING);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Resume Bullet Optimizer</h1>
          <p className="text-xs text-slate-500">
            {SENIORITY[session.seniority]?.label} · resume loaded
            {session.experienceText ? ' · experience notes loaded' : ' · no experience notes'}
          </p>
        </div>
        <button className="btn-ghost" onClick={onReset}>Change documents</button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
      )}

      {!active ? (
        <SectionPicker
          analysis={analysis}
          worked={worked}
          onPick={openSection}
          onPickCustom={(text) => {
            // Match against what was found; otherwise tell the user plainly.
            const hit = analysis.sections.find((s) =>
              `${s.heading} ${s.points.map((p) => p.text).join(' ')}`
                .toLowerCase()
                .includes(text.toLowerCase())
            );
            if (hit) openSection(hit);
            else setError(`Couldn’t find a section matching “${text}”. Pick one from the list above.`);
          }}
        />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <button className="btn-ghost" onClick={() => setActive(null)}>← All sections</button>
            <div className="flex-1">
              <h2 className="text-base font-semibold">{active.section.heading}</h2>
              {active.section.context && (
                <p className="text-xs text-slate-500">{active.section.context}</p>
              )}
            </div>
            <span className="text-xs text-slate-400">
              {improved} of {active.points.length} improved
            </span>
          </div>

          <div className="space-y-3">
            {active.points.map((p, i) => (
              <PointCard
                key={p.id}
                point={p}
                index={i}
                busy={busy || busyPoint === p.id}
                onRegenerate={(instruction) => regenerate(p, instruction)}
                onEdit={(text) => editPoint(p, text)}
              />
            ))}
          </div>

          {done && (
            <div className="flex items-center gap-3 border-t border-slate-200 pt-5">
              <button className="btn-primary" onClick={copySection}>Copy this section</button>
              <button className="btn-ghost" onClick={() => setActive(null)}>
                Work on another section
              </button>
              <span className="ml-auto text-xs text-slate-400">saved in this browser</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
