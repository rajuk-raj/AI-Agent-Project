/**
 * Client-side wrapper for the /api routes.
 *
 * Each route is one LLM call, which keeps every serverless invocation well
 * inside the free-tier function timeout. Sequencing and retries live in
 * lib/workspace.js and shared/optimizeLoop.js, not here.
 */

class ApiError extends Error {
  constructor(message, { retryable = false, status } = {}) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

async function post(route, body, { retries = 2 } = {}) {
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(`/api/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = new ApiError(`Network error calling ${route}`, { retryable: true });
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }

    const payload = await res.json().catch(() => ({}));
    if (res.ok) return payload;

    lastErr = new ApiError(payload.error || `Request failed (${res.status})`, {
      retryable: Boolean(payload.retryable) || res.status === 429 || res.status >= 500,
      status: res.status,
    });

    if (!lastErr.retryable || attempt === retries) throw lastErr;
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }

  throw lastErr;
}

export const decompose = (body) => post('decompose', body);
export const extractSections = (body) => post('sections', body);
export const refine = (body) => post('refine', body);
// Search + fetch is slower than a plain model call, so allow a longer wait.
export const resolveJd = (body) => post('jd', body, { retries: 1 });
export const mapCompetency = (body) => post('map-competency', body);
export const rewrite = (body) => post('rewrite', body);
export const score = (body) => post('score', body);
export const generateQuestions = (body) => post('questions', body);
