// A password-protected database of songs. Songs themselves (title, artist,
// link, lyrics) live in one shared library; each database holds its own
// tags, ratings, playlists and categories on top of them.
export interface DatabaseInfo {
  id: string;
  name: string;
  // Whether songs here usually come from Ultimate Guitar — enables the "search
  // Ultimate Guitar" fallback for songs with no link of their own.
  ugSearchFallback: boolean;
}

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

export interface SongRecording {
  id: string;
  title: string;
  // Path within the private "audio" Storage bucket — not a playable URL by
  // itself, fetched through an authenticated download (see
  // getSongAudioUrl) so it stays behind the same passphrase gate as
  // everything else.
  path: string;
}

export interface Song {
  // The song's entry in the open database (not the shared library's id — see
  // sharedSongId). Playlists, the queue, and recordings all key off this.
  id: string;
  sharedSongId: string;
  // The database that created the song and is the only one that can edit its
  // title, artist, link, and shared lyrics/genre.
  ownerDbId: string;
  isOwner: boolean;
  // Non-owner databases can unlink lyrics or genre to keep their own version.
  lyricsUnlinked: boolean;
  genreUnlinked: boolean;
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
  // In whatever order they were added — no cap, no manual reordering.
  recordings: SongRecording[];
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

// A song's appearance in the working queue before it's saved — carries a
// leader if it came from an imported playlist (see QueueState), so
// re-saving over that playlist doesn't silently drop existing assignments.
export interface QueueEntry {
  songId: string;
  leader: string | null;
}

// Which playlist (if any) the current queue was imported from — set by
// "Load into queue" and cleared whenever the queue is emptied or a
// different playlist is imported. Drives whether "Save" offers to update
// that playlist in place or only to save as a new one.
export interface QueueState {
  entries: QueueEntry[];
  importedFromPlaylistId: string | null;
}

// The row shown in the Playlists list — the full ordered song/leader list
// is only fetched when a playlist is actually opened (see
// getPlaylistDetail).
export interface PlaylistSummary {
  id: string;
  name: string;
  songCount: number;
  createdAt: string;
  showDate: string | null;
}

export interface PlaylistHistory {
  playlists: { id: string; name: string; showDate: string | null }[];
  songs: { songId: string; title: string; artist: string }[];
  appearances: { playlistId: string; songId: string; leader: string | null; position: number }[];
}

export interface PlaylistSong {
  songId: string;
  title: string;
  artist: string;
  leader: string | null;
}

export interface PlaylistDetail {
  id: string;
  name: string;
  showDate: string | null;
  songs: PlaylistSong[];
}
