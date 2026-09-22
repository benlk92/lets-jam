export interface Category {
  id: string;
  name: string;
  // Derived at read time (like Staleness) rather than manually tagged —
  // excluded from the tag editor, but filterable/sortable like any category.
  computed?: boolean;
  // Whether this category gets its own Guided Picker step. Defaults to true
  // when unset — still usable in Filters/Sort either way.
  guidedPickerEnabled?: boolean;
  // Whether this category gets its own cluster on the Scatter Picker
  // screen. Opt-in (defaults false) — unlike guidedPickerEnabled, an unset
  // value here means "not shown."
  scatterPickerEnabled?: boolean;
  // Values explicitly registered via Settings' "Values" screen — merged with
  // whatever songs currently carry, so a value can exist as a selectable
  // option before any song has been tagged with it yet.
  values?: string[];
}

export type TagValue = string;

export interface RatingScaleEntry {
  label: string;
  intervalDays: number;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  ultimateGuitarUrl: string;
  memorized: boolean;
  lastPlayedAt: string | null;
  lastRatingLabel: string | null;
  playCount: number;
  // Freeform text — chord line directly above the lyric line it applies to,
  // matching the plain-text format of an Ultimate Guitar chord-sheet export.
  chordChart: string | null;
  // Path of the song's attached recording within the private "audio"
  // Storage bucket, or null if none is attached. Not a playable URL by
  // itself — fetched through an authenticated download (see
  // getSongAudioUrl) so it stays behind the same passphrase gate as
  // everything else.
  audioPath: string | null;
  tags: Record<string, TagValue>;
  // Category ids the song has been deliberately marked as not applying to
  // (from Gap-Fill's "Doesn't apply" option) — the tag itself stays blank
  // (so Filters/"Include untagged" behavior is unaffected), this only tells
  // Gap-Fill to stop offering the song for that category.
  notApplicableCategories: string[];
}

export interface CategoryFilter {
  values?: string[];
}

export type FilterState = Record<string, CategoryFilter>;

export interface SortCriterion {
  key: string;
  direction: 'asc' | 'desc';
}
