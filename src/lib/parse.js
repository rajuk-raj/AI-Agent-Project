/**
 * Client-side file parsing.
 *
 * Runs entirely in the browser: resume text never touches our server except as
 * part of an LLM call, and there is no upload round-trip to pay for.
 */

import mammoth from 'mammoth';

export const ACCEPTED = '.pdf,.docx,.txt,.md';

export async function parseFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.txt') || name.endsWith('.md')) {
    return clean(await file.text());
  }

  if (name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return clean(value);
  }

  if (name.endsWith('.pdf')) {
    return clean(await parsePdf(file));
  }

  if (name.endsWith('.doc')) {
    throw new Error('Legacy .doc isn’t supported. Save as .docx or paste the text instead.');
  }

  throw new Error(`Unsupported file type. Use PDF, DOCX, or TXT — or paste the text.`);
}

async function parsePdf(file) {
  // Loaded lazily: pdf.js is heavy and most users paste or upload DOCX.
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    // Rebuild lines from item positions — pdf.js emits positioned fragments,
    // and joining them naively runs every bullet of a resume into one line.
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], str: item.str });
    }

    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0]) // top of page first
      .map(([, parts]) =>
        parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim()
      );

    pages.push(lines.join('\n'));
  }

  const text = pages.join('\n\n');
  if (!text.trim()) {
    // Scanned/image-only PDFs extract to nothing. Say so plainly rather than
    // letting the agent run on an empty string and report "0 bullets found".
    throw new Error(
      'No text found in this PDF — it may be a scan or an image. Paste your resume text instead.'
    );
  }
  return text;
}

function clean(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[•▪●·]\s*/g, '- ') // normalise bullet glyphs
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
