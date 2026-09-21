// Transposes a plain-text chord chart in the standard "chord line directly
// above the lyric line it applies to" format — chord names are positioned
// with leading spaces so they line up (in a monospace font) with the exact
// syllable they change on. Transposing only ever rewrites whole chord
// *lines* in place (replacing each chord token, leaving all other spacing
// untouched); lyric lines, section headers ([Verse 1]), and tab/fretboard
// diagrams are left completely alone.
//
// A chord name that gets longer or shorter when transposed (e.g. A -> A#)
// will shift anything later on the same line by a character or two — an
// inherent limitation of plain-text chord sheets, not something worth
// solving by reflowing the whole chart.

const CHROMATIC = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

const FLAT_TO_SHARP: Record<string, string> = {
  Ab: 'G#',
  Bb: 'A#',
  Cb: 'B',
  Db: 'C#',
  Eb: 'D#',
  Fb: 'E',
  Gb: 'F#',
};

// Root + optional accidental, then a chord-quality suffix built only from
// real chord-quality vocabulary (m, maj7, sus4, dim, add9, 7, ...) and
// digits/accidentals, then an optional slash bass note. The suffix is
// restricted to this vocabulary (rather than "any letters") so that section
// labels starting with a chord letter — "Chorus", "Bridge", "Coda" — don't
// get misread as a chord token and transposed.
const QUALITY = '(?:maj|min|dim|aug|sus|add|no|m|M|[0-9#b+-])*';
const CHORD_TOKEN = new RegExp(`^([A-G])([#b]?)(${QUALITY})(?:\\/([A-G])([#b]?))?$`);

function noteIndex(letter: string, accidental: string): number {
  const name = letter + accidental;
  const normalized = accidental === 'b' ? (FLAT_TO_SHARP[name] ?? name) : name;
  return CHROMATIC.indexOf(normalized);
}

function transposeNote(letter: string, accidental: string, semitones: number): string {
  const idx = noteIndex(letter, accidental);
  if (idx === -1) return letter + accidental;
  return CHROMATIC[(((idx + semitones) % 12) + 12) % 12];
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
