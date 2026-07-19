/**
 * Client-side file parsing.
 *
 * Runs entirely in the browser: resume text never touches our server except as
 * part of an LLM call, and there is no upload round-trip to pay for.
 */

import mammoth from 'mammoth';
import { itemsToLines, cleanResumeText } from '../../shared/pdfText.js';

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
    // Shared with the Node tests, so what runs here is what was verified.
    pages.push(itemsToLines(content.items).join('\n'));
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

const clean = cleanResumeText;
