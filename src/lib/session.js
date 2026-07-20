/**
 * Session persistence.
 *
 * Resume and experience notes are supplied once and reused for every request
 * in the workspace, so they survive a refresh.
 *
 * Stored in localStorage, which stays on this machine — no server, no database,
 * nothing transmitted except as part of a model call. That keeps the PRD's
 * privacy guardrail intact, but it does mean resume text sits in the browser
 * profile until cleared, so clearSession() is exposed prominently in the UI
 * rather than buried.
 */

const KEY = 'rbo.session.v1';

const EMPTY = {
  resumeText: '',
  experienceText: '',
  seniority: 'PM',
  // Set once after upload: the sections found, plus current competency coverage.
  analysis: null,
  // Rewritten points, keyed by section id, so revisiting a section costs nothing.
  results: {},
  // Target job description, if the user supplied or found one. Influences
  // emphasis and wording only — never treated as evidence about the candidate.
  jd: null,
};

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    // Merge over EMPTY so an older stored shape can't leave fields undefined.
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Quota exceeded, or storage disabled (private mode). The app still works
    // for this session; only persistence across reloads is lost.
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

export function hasDocuments(session) {
  return Boolean(session?.resumeText?.trim());
}
