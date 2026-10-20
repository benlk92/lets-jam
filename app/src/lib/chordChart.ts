// Transposes a plain-text chord chart in the standard "chord line directly
// above the lyric line it applies to" format — chord names are positioned
// with leading spaces so they line up (in a monospace font) with the exact
// syllable they change on. Transposing only ever rewrites whole chord
// *lines* in place (replacing each chord token, leaving all other spacing
// untouched); lyric lines, section headers ([Verse 1]), and tab/fretboard
// diagrams are left completely alone.
//
// A chord name that gets longer or shorter when transposed (e.g. A -> Bb)
// will shift anything later on the same line by a character or two — an
// inherent limitation of plain-text chord sheets, not something worth
// solving by reflowing the whole chart.

// The spelling each pitch class is displayed with — whichever of the
// sharp/flat enharmonic pair has fewer accidentals in its own major key
// (e.g. Eb, 3 flats, over D#, 9 sharps). F#/Gb is the one true tie (6
// accidentals either way); by convention that's always spelled F#.
const PITCH_CLASSES = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab'];

const NATURAL_INDEX: Record<string, number> = { A: 0, B: 2, C: 3, D: 5, E: 7, F: 8, G: 10 };

// Root + optional accidental, then a chord-quality suffix built only from
// real chord-quality vocabulary (m, maj7, sus4, dim, add9, 7, ...) and
// digits/accidentals, then an optional slash bass note. The suffix is
// restricted to this vocabulary (rather than "any letters") so that section
// labels starting with a chord letter — "Chorus", "Bridge", "Coda" — don't
// get misread as a chord token and transposed.
const QUALITY = '(?:maj|min|dim|aug|sus|add|no|m|M|[0-9#b+-])*';
const CHORD_TOKEN = new RegExp(`^([A-G])([#b]?)(${QUALITY})(?:\\/([A-G])([#b]?))?$`);

function noteIndex(letter: string, accidental: string): number {
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (((NATURAL_INDEX[letter] + shift) % 12) + 12) % 12;
}

function transposeNote(letter: string, accidental: string, semitones: number): string {
  const idx = noteIndex(letter, accidental);
  return PITCH_CLASSES[(idx + semitones) % 12];
}

function transposeToken(token: string, semitones: number): string {
  const m = token.match(CHORD_TOKEN);
  if (!m) return token;
  const [, rootLetter, rootAcc, quality, bassLetter, bassAcc] = m;
  const root = transposeNote(rootLetter, rootAcc, semitones);
  const bass = bassLetter ? transposeNote(bassLetter, bassAcc, semitones) : null;
  return root + quality + (bass ? '/' + bass : '');
}

// A line counts as a chord line when every token containing a letter is
// itself a valid chord token — lets bare punctuation ("A Bm D A ,") pass
// through without disqualifying the line. A trailing parenthetical, like
// "C  G  (over verse)", is stripped before that check (real chord charts
// commonly annotate a line this way) — the annotation itself still passes
// through untouched in transposeChordChart since it never matches a chord
// token.
export function isChordLine(line: string): boolean {
  const withoutTrailingNote = line.replace(/\s*\([^()]*\)\s*$/, '');
  const tokens = withoutTrailingNote.trim().split(/\s+/).filter(Boolean);
  const lettered = tokens.filter((t) => /[A-Za-z]/.test(t));
  if (lettered.length === 0) return false;
  return lettered.every((t) => CHORD_TOKEN.test(t));
}

export function transposeChordChart(text: string, semitones: number): string {
  const normalized = ((semitones % 12) + 12) % 12;
  if (normalized === 0) return text;
  return text
    .split('\n')
    .map((line) => (isChordLine(line) ? line.replace(/\S+/g, (tok) => transposeToken(tok, normalized)) : line))
    .join('\n');
}

// --- Chord numbers (Nashville-style) ---------------------------------------
// Rewrites each chord as its scale degree in a major key: in F, F -> 1,
// Bb -> 4, C -> 5. A bare number means "the chord that normally lives on
// that degree" (major on 1/4/5, minor on 2/3/6, diminished on 7), so in F,
// Gm -> 2 but G major -> 2M, and Bb minor -> 4m. Chromatic roots are
// spelled with b/# (Eb -> b7). An extension that starts with something
// other than a letter goes in parentheses so it can't be read as part of the
// number: Gm7 -> 2(7), F7 -> 1(7), while Fmaj7 -> 1maj7 and Csus4 -> 5sus4.
// A slash bass note becomes a degree too: F/A -> 1/3.

export const KEY_NAMES = PITCH_CLASSES;

const DEGREE_NAMES = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
const DEFAULT_QUALITY: Record<number, 'M' | 'm' | 'dim'> = { 0: 'M', 2: 'm', 4: 'm', 5: 'M', 7: 'M', 9: 'm', 11: 'dim' };

type QualityKind = 'major' | 'minor' | 'dim' | 'aug' | 'neutral';

function splitQuality(quality: string): { kind: QualityKind; ext: string } {
  if (/sus|no3/.test(quality)) return { kind: 'neutral', ext: quality };
  if (quality.startsWith('maj')) return { kind: 'major', ext: quality };
  if (quality.startsWith('min')) return { kind: 'minor', ext: quality.slice(3) };
  if (quality.startsWith('m')) return { kind: 'minor', ext: quality.slice(1) };
  if (quality.startsWith('dim')) return { kind: 'dim', ext: quality.slice(3) };
  if (quality.startsWith('aug')) return { kind: 'aug', ext: quality.slice(3) };
  if (quality.startsWith('+')) return { kind: 'aug', ext: quality.slice(1) };
  if (quality === 'M') return { kind: 'major', ext: '' };
  return { kind: 'major', ext: quality };
}

function parseChord(token: string) {
  const m = token.match(CHORD_TOKEN);
  if (!m) return null;
  const [, rootLetter, rootAcc, quality, bassLetter, bassAcc] = m;
  return {
    root: noteIndex(rootLetter, rootAcc),
    quality,
    bass: bassLetter ? noteIndex(bassLetter, bassAcc) : null,
  };
}

function tokenToNumber(token: string, tonic: number): string {
  const chord = parseChord(token);
  if (!chord) return token;

  const degree = (chord.root - tonic + 12) % 12;
  const expected = DEFAULT_QUALITY[degree] ?? 'M';
  const { kind, ext } = splitQuality(chord.quality);
  const extIsExplicit = /^(maj|M)/.test(ext);

  let marker = '';
  if (kind === 'major' && expected !== 'M' && !extIsExplicit) marker = 'M';
  else if (kind === 'minor' && (expected !== 'm' || extIsExplicit)) marker = 'm';
  else if (kind === 'dim' && expected !== 'dim') marker = 'dim';
  else if (kind === 'aug') marker = 'aug';

  const extension = ext && !/^[A-Za-z]/.test(ext) ? `(${ext})` : ext;
  const bass = chord.bass !== null ? `/${DEGREE_NAMES[(chord.bass - tonic + 12) % 12]}` : '';
  return DEGREE_NAMES[degree] + marker + extension + bass;
}

// Replacing a name with a number changes its width, so the spaces after it
// absorb the difference (never dropping below one) — the chords stay lined up
// over the syllables they belong to.
function rewriteChordLine(line: string, tonic: number): string {
  return line.replace(/(\S+)(\s*)/g, (_match, token: string, spaces: string) => {
    const next = tokenToNumber(token, tonic);
    if (next === token) return token + spaces;
    const keep = spaces.length === 0 ? 0 : Math.max(1, spaces.length - (next.length - token.length));
    return next + ' '.repeat(keep);
  });
}

export function chordLineToNumbers(line: string, tonic: number): string {
  return rewriteChordLine(line, tonic);
}

// A best guess at the major key a chart is in (as an index into KEY_NAMES):
// each candidate key scores a point for every chord that is the diatonic
// chord on its degree, a little for the right root with the wrong quality,
// and a bonus when the chart opens or closes on the tonic (or on the
// relative minor, which is just as often "home"). Charts in a minor key
// come out as their relative major, so Am-F-C-G reads 6-4-1-5.
export function detectKey(text: string): number | null {
  const chords = text
    .split('\n')
    .filter(isChordLine)
    .flatMap((line) => line.split(/\s+/).filter(Boolean))
    .map((token) => {
      const chord = parseChord(token);
      return chord ? { root: chord.root, kind: splitQuality(chord.quality).kind } : null;
    })
    .filter((c): c is { root: number; kind: QualityKind } => c !== null);
  if (chords.length === 0) return null;

  const first = chords[0];
  const last = chords[chords.length - 1];
  let best = 0;
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    let score = 0;
    for (const { root, kind } of chords) {
      const degree = (root - tonic + 12) % 12;
      const expected = DEFAULT_QUALITY[degree];
      if (expected === undefined) continue;
      const matches =
        (expected === 'M' && (kind === 'major' || kind === 'neutral')) ||
        (expected === 'm' && kind === 'minor') ||
        (expected === 'dim' && kind === 'dim');
      score += matches ? 1 : 0.3;
    }
    for (const edge of [first, last]) {
      const degree = (edge.root - tonic + 12) % 12;
      if (degree === 0 || (degree === 9 && edge.kind === 'minor')) score += 0.5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = tonic;
    }
  }
  return best;
}

// --- Wrapping ---------------------------------------------------------------
// Fits a chart to a fixed number of columns for a screen that must never
// scroll sideways. A chord line and the lyric line under it are cut at the
// same column and re-emitted as stacked pairs, so every chord stays over the
// syllable it belongs to. Breaks prefer a space in the lyric where no chord
// is mid-name; a chord is only ever split if there is nowhere else to cut.
// `mapChordLine` (e.g. names -> numbers) runs on each finished chord line.

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function findBreak(chord: string, lyric: string, start: number, maxCols: number): number {
  const limit = start + maxCols;
  for (let p = limit; p > start; p--) {
    const lyricOk = p >= lyric.length || lyric[p] === ' ';
    const chordOk = p >= chord.length || chord[p] === ' ';
    if (lyricOk && chordOk) return p;
  }
  let p = limit;
  while (p > start + 1 && chord[p] !== undefined && chord[p] !== ' ' && chord[p - 1] !== ' ') p--;
  return p > start + 1 ? p : limit;
}

function wrapPair(chord: string, lyric: string, maxCols: number, mapChordLine: (line: string) => string): string[] {
  const width = Math.max(chord.length, lyric.length);
  const emit = (c: string, l: string): string[] => {
    const out: string[] = [];
    if (c.trim()) out.push(mapChordLine(c.trimEnd()));
    if (l.trim() || !c.trim()) out.push(l.trimEnd());
    return out;
  };
  if (width <= maxCols) return emit(chord, lyric);

  const out: string[] = [];
  let start = 0;
  while (start < width) {
    const end = width - start <= maxCols ? width : findBreak(chord, lyric, start, maxCols);
    let c = chord.slice(start, end);
    let l = lyric.slice(start, end);
    const strip = Math.min(c.trim() ? leadingSpaces(c) : Infinity, l.trim() ? leadingSpaces(l) : Infinity);
    if (strip !== Infinity) {
      c = c.slice(strip);
      l = l.slice(strip);
    }
    if (c.trim() || l.trim()) out.push(...emit(c, l));
    start = end;
  }
  return out;
}

export function wrapChordChart(
  text: string,
  maxCols: number,
  mapChordLine: (line: string) => string = (line) => line,
): string {
  if (maxCols < 8) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isChordLine(line)) {
      const next = lines[i + 1];
      const pairs = next !== undefined && next.trim() !== '' && !isChordLine(next) && !/^\s*\[.*\]\s*$/.test(next);
      out.push(...wrapPair(line, pairs ? next : '', maxCols, mapChordLine));
      if (pairs) i++;
    } else {
      out.push(...wrapPair('', line, maxCols, mapChordLine));
    }
  }
  return out.join('\n');
}
