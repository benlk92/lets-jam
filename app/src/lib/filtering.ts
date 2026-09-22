import type { Category, FilterState, RatingScaleEntry, Song, SortCriterion } from '../types';
import { stalenessDays } from './staleness';

// The one category with its own dedicated picker entry point (the Genre
// Picker) — locked against retirement in Settings, and always excluded
// from the Scatter Picker regardless of its own toggle, since it already
// has a faster, purpose-built way to get to it.
export const GENRE_CATEGORY_ID = 'genre_2';

// Fisher-Yates — an unbiased shuffle, unlike sorting by Math.random() which
// skews toward whatever the sort algorithm's comparison pattern favors.
export function shuffledSample<T>(items: T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// Registered values (category.values) define the display order — reordered
// from Settings' Values screen. Anything found on a song but not yet
// registered has no defined position, so it's appended alphabetically at
// the end rather than dropped.
export function categoryValues(
  songs: Song[],
  categoryId: string,
  ratingScale?: RatingScaleEntry[],
  registeredValues?: string[],
): string[] {
  // A computed boolean, not vocabulary that emerges from usage — always
  // both options regardless of what any song currently has. Deriving this
  // from what's actually on the songs (like the generic path below) means
  // a roster with zero memorized songs yet — a freshly imported space, or
  // just before the first song is ever marked — could only ever offer "Not
  // memorized," with no option to pick the other one at all.
  if (categoryId === 'memorized') {
    return ['Memorized', 'Not memorized'];
  }

  // Performance/Memorization Confidence have no independent value list of
  // their own to register (see Settings) — every rating-scale label is
  // always a valid option, even for a song that's never been rated, so
  // Gap-Fill has something to offer instead of an empty picker. They mirror
  // rating-scale quality order, not registration order.
  if (isConfidenceCategory(categoryId) && ratingScale) {
    const set = new Set<string>(registeredValues ?? []);
    ratingScale.forEach((r) => set.add(r.label));
    for (const song of songs) {
      const v = song.tags[categoryId];
      if (typeof v === 'string') set.add(v);
    }
    const rank = new Map(ratingScale.map((r, i) => [r.label, i]));
    return Array.from(set).sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const v of registeredValues ?? []) {
    if (!seen.has(v)) {
      seen.add(v);
      ordered.push(v);
    }
  }

  const extras: string[] = [];
  for (const song of songs) {
    const v = song.tags[categoryId];
    if (typeof v === 'string' && !seen.has(v)) {
      seen.add(v);
      extras.push(v);
    }
  }
  extras.sort((a, b) => a.localeCompare(b));

  return [...ordered, ...extras];
}

export function songMatchesFilters(
  song: Song,
  filters: FilterState,
  categories: Category[],
  includeUntagged: boolean,
): boolean {
  for (const category of categories) {
    const f = filters[category.id];
    if (!f || !f.values || f.values.length === 0) continue;
    const tagValue = song.tags[category.id];
    if (tagValue == null) {
      if (!includeUntagged) return false;
      continue;
    }
    if (!f.values.includes(tagValue)) return false;
  }
  return true;
}

export function filterSongs(
  songs: Song[],
  filters: FilterState,
  categories: Category[],
  includeUntagged: boolean,
): Song[] {
  return songs.filter((s) => songMatchesFilters(s, filters, categories, includeUntagged));
}

function tagSortValue(song: Song, categoryId: string): string | null {
  return song.tags[categoryId] ?? null;
}

function isConfidenceCategory(categoryId: string): boolean {
  return categoryId === 'performance_confidence' || categoryId === 'memorization_confidence';
}

export function confidenceScore(song: Song, key: string, ratingScale: RatingScaleEntry[]): number | null {
  const value = song.tags[key];
  if (typeof value !== 'string') return null;
  const idx = ratingScale.findIndex((r) => r.label === value);
  if (idx === -1) return null;
  return ratingScale.length - idx; // higher score = better rating
}

// Pre-compensates for sortSongs' direction flip so a "not applicable" value
// (null) always sorts last, regardless of whether the criterion is asc or
// desc — otherwise "most overdue first" would put non-memorized songs
// (which have no staleness) at the very top instead of out of the way.
function nullsLast(aIsNull: boolean, direction: 'asc' | 'desc'): number {
  const base = aIsNull ? 1 : -1;
  return direction === 'asc' ? base : -base;
}

function compareByKey(a: Song, b: Song, key: string, direction: 'asc' | 'desc', ratingScale: RatingScaleEntry[]): number {
  if (key === 'staleness') {
    const as = stalenessDays(a, ratingScale);
    const bs = stalenessDays(b, ratingScale);
    if (as == null && bs == null) return 0;
    if (as == null) return nullsLast(true, direction);
    if (bs == null) return nullsLast(false, direction);
    // Infinity - Infinity is NaN, not 0 — both never-played songs need to
    // tie explicitly so a secondary sort key still gets a turn.
    if (!isFinite(as) && !isFinite(bs)) return 0;
    return as - bs;
  }
  if (isConfidenceCategory(key)) {
    const as = confidenceScore(a, key, ratingScale);
    const bs = confidenceScore(b, key, ratingScale);
    if (as == null && bs == null) return 0;
    if (as == null) return nullsLast(true, direction);
    if (bs == null) return nullsLast(false, direction);
    return as - bs;
  }
  if (key === 'title') return a.title.localeCompare(b.title);
  if (key === 'artist') return a.artist.localeCompare(b.artist);

  const av = tagSortValue(a, key);
  const bv = tagSortValue(b, key);
  if (av == null && bv == null) return 0;
  if (av == null) return nullsLast(true, direction);
  if (bv == null) return nullsLast(false, direction);
  return av.localeCompare(bv);
}

export function sortSongs(songs: Song[], criteria: SortCriterion[], ratingScale: RatingScaleEntry[]): Song[] {
  if (criteria.length === 0) return songs;
  return [...songs].sort((a, b) => {
    for (const c of criteria) {
      const cmp = compareByKey(a, b, c.key, c.direction, ratingScale);
      if (cmp !== 0) return c.direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}
