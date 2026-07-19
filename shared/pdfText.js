/**
 * Rebuilding readable lines from PDF text fragments.
 *
 * pdf.js emits positioned glyph runs, not lines. Joining them in emission
 * order collapses an entire resume into one paragraph, which destroys the one
 * thing the decomposer depends on: one bullet per line.
 *
 * Pure and environment-free so it can be tested against real PDFs in Node
 * while running unchanged in the browser.
 */

/** Fragments closer than this share a line, absorbing sub-pixel baseline drift. */
const Y_TOLERANCE = 2.5;

/** A horizontal gap wider than this many multiples of font size is a real space. */
const SPACE_RATIO = 0.25;

/**
 * @param {Array<{str:string, transform:number[], width?:number, height?:number}>} items
 * @returns {string[]} lines, top to bottom
 */
export function itemsToLines(items) {
  const frags = items
    .filter((i) => i?.str && i.str.trim())
    .map((i) => ({
      x: i.transform[4],
      y: i.transform[5],
      str: i.str,
      width: i.width ?? 0,
      size: i.height ?? Math.abs(i.transform[3]) ?? 10,
    }));

  if (!frags.length) return [];

  // Group by baseline. Exact equality fails on real PDFs — glyph runs on the
  // same visual line routinely differ by a fraction of a point.
  const rows = [];
  for (const f of frags.sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r.y - f.y) <= Y_TOLERANCE);
    if (row) row.items.push(f);
    else rows.push({ y: f.y, items: [f] });
  }

  return rows
    .map((row) => {
      const sorted = row.items.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEnd = null;
      let prevSize = 10;

      for (const f of sorted) {
        if (prevEnd !== null) {
          const gap = f.x - prevEnd;
          // Only insert a space for a real gap. PDFs often split a single word
          // across fragments with no gap at all ("Prod" + "uct"); adding a
          // space there would corrupt the text.
          if (gap > prevSize * SPACE_RATIO && !/\s$/.test(line) && !/^\s/.test(f.str)) {
            line += ' ';
          }
        }
        line += f.str;
        prevEnd = f.x + f.width;
        prevSize = f.size;
      }

      return line.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

/** Normalise extracted resume text for the decomposer. */
export function cleanResumeText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[•▪●·‣⁃]\s*/g, '- ') // bullet glyphs -> "- "
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}
