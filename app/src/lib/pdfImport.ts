import * as pdfjsLib from 'pdfjs-dist';
// Vite serves the worker as a static asset and gives us its built URL —
// pdf.js can't run its parsing on the main thread without one.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PositionedItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

// Ultimate Guitar's chord-sheet PDFs set each text run at an absolute (x, y)
// position rather than relying on literal space characters, so a plain
// "concatenate the text" extraction loses the column alignment that makes a
// chord line line up with the lyric syllable underneath it. This rebuilds
// that alignment: items are clustered into rows by y-position, then each
// row is re-padded with spaces based on its own estimated monospace
// character width, so a chord run 20 "columns" in stays 20 columns in.
export async function extractChordChartFromPdf(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    const items: PositionedItem[] = [];
    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str) continue;
      const transform = raw.transform as number[];
      items.push({ str: raw.str, x: transform[4], y: transform[5], width: raw.width ?? 0 });
    }
    if (items.length === 0) continue;

    // Cluster into rows: sort top-to-bottom (PDF y grows upward) then
    // left-to-right, grouping items whose y is within a couple points of
    // the row's first item — same baseline, allowing for float noise.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PositionedItem[][] = [];
    for (const item of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row[0].y - item.y) < 2) row.push(item);
      else rows.push([item]);
    }

    const lines = rows.map((row) => {
      row.sort((a, b) => a.x - b.x);
      const widths = row.filter((i) => i.str.trim().length > 0).map((i) => i.width / i.str.length);
      const charWidth = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : 5;
      const minX = row[0].x;

      let line = '';
      for (const item of row) {
        const col = Math.max(0, Math.round((item.x - minX) / charWidth));
        while (line.length < col) line += ' ';
        line += item.str;
      }
      return line.replace(/\s+$/, '');
    });

    pageTexts.push(lines.join('\n'));
  }

  const result = pageTexts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  // Ultimate Guitar's own PDF export renders each page as a flat image
  // rather than real text (confirmed against a real export) — there's
  // nothing here for a text-layer extractor like this one to find. The
  // caller shows a specific message for this rather than a generic failure.
  if (!result) throw new Error('NO_TEXT_LAYER');

  return result;
}
