/**
 * Web search and page retrieval for job descriptions (Serper.dev).
 *
 * SECURITY NOTE — everything this module returns is UNTRUSTED external
 * content. A job posting is a web page; a web page can contain text aimed at
 * a language model ("ignore previous instructions and…"). Callers must treat
 * the output as data to be summarised, never as instructions, and must not
 * let it into the set of documents the fabrication check treats as evidence
 * about the candidate.
 */

const SERPER_URL = 'https://google.serper.dev/search';

/** Only ever follow ordinary web URLs. */
function isSafeUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    // Don't let a search result point us at the local network.
    const host = u.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) // bare IPs — no legitimate JD lives here
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function searchJobDescription({ company, role, limit = 6 }) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    const err = new Error(
      'SERPER_API_KEY is not set. Add it to .env.local, or paste the job description by hand.'
    );
    err.code = 'NO_SEARCH_KEY';
    throw err;
  }

  const q = [company, role, 'job description responsibilities requirements']
    .filter(Boolean)
    .join(' ');

  const res = await fetch(SERPER_URL, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, num: limit }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Search failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.organic ?? [])
    .filter((r) => r.link && isSafeUrl(r.link))
    .map((r) => ({ title: r.title, link: r.link, snippet: r.snippet ?? '' }));
}

/**
 * Best-effort fetch of a job posting's text.
 *
 * Many boards render via JS or block non-browser clients, so failure is
 * expected and handled by falling back to search snippets rather than
 * pretending we have the full posting.
 */
export async function fetchPageText(url, { timeoutMs = 9000, maxChars = 12000 } = {}) {
  if (!isSafeUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/html') && !type.includes('text/plain')) return null;

    const html = await res.text();
    const text = htmlToText(html).slice(0, maxChars);
    // Too short to be a real posting — treat as a failed fetch rather than
    // feeding a cookie banner into the model.
    return text.length > 400 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
