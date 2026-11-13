// Reads an Ultimate Guitar "share" text file: the first line is the song
// title ("Title chords ***"), the second the artist ("Artist 1961 (Album)"),
// and the rest is the chart.

export interface ParsedChartFile {
  title: string;
  artist: string;
  chart: string;
}

// Straight quotes, so imported titles match the library's spelling.
function straighten(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

export function parseChartFile(raw: string): ParsedChartFile | null {
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0) return null;
  const second = lines.findIndex((l, i) => i > first && l.trim() !== '');
  if (second < 0) return null;

  const title = straighten(
    lines[first]
      .replace(/\s*\*+\s*$/, '')
      .replace(/\s+(ukulele chords|bass tabs|chords|tabs|tab|chord)\s*$/i, '')
      .trim(),
  );
  const artist = straighten(
    lines[second]
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\s+(19|20)\d{2}\s*$/, '')
      .trim(),
  );
  if (!title || !artist) return null;

  // Keep the first line's indentation (it can be a chord line); only drop the
  // blank lines before the chart and the whitespace after it.
  const chart = lines.slice(second + 1).join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
  return { title, artist, chart };
}
