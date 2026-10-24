import type {
  Category,
  DatabaseInfo,
  PlaylistDetail,
  PlaylistHistory,
  PlaylistSummary,
  QueueEntry,
  RatingScaleEntry,
  Song,
  SongRecording,
  TagValue,
} from '../types';
import { getSupabaseClient } from './supabaseClient';
import {
  enqueuePendingWrite,
  getPendingWrites,
  isNetworkError,
  loadSnapshot,
  removePendingWrite,
  saveSnapshot,
  updateCachedSong as updateCachedSongIn,
} from './offlineCache';
import { GENRE_CATEGORY_ID } from '../lib/filtering';

// Supabase-backed data layer. Songs live in a shared library (title, artist,
// link, lyrics, genre); each database holds its own entry per song (tags,
// ratings, recordings, playlists) on top of it. Every screen talks to this
// module only.

// Which database every read/write below is scoped to — set by the app when a
// database is opened. Row security enforces it server-side (the request also
// carries that database's password); this is just which one the client asks for.
let currentDb = '';

export function setCurrentDatabase(databaseId: string) {
  currentDb = databaseId;
}

export function getCurrentDatabase(): string {
  return currentDb;
}

function updateCachedSong(song: Song) {
  updateCachedSongIn(currentDb, song);
}

// A song entry joined to its shared song — what every read selects, and the
// shape the server functions return.
const SONG_SELECT = '*, shared_songs(*)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSongRow(row: any): Song {
  const shared = row.shared_songs;
  const isOwner = shared.owner_db === row.db_id;
  // The owner always follows its own shared values; the unlink flags only
  // mean something for a database that doesn't own the song.
  const lyricsUnlinked = !isOwner && !!row.lyrics_unlinked;
  const genreUnlinked = !isOwner && !!row.genre_unlinked;
  const genre = genreUnlinked ? row.genre_override : shared.genre;
  const tags: Record<string, TagValue> = { ...(row.tags ?? {}) };
  if (genre) tags[GENRE_CATEGORY_ID] = genre;
  else delete tags[GENRE_CATEGORY_ID];

  return {
    id: row.id,
    sharedSongId: shared.id,
    ownerDbId: shared.owner_db,
    isOwner,
    lyricsUnlinked,
    genreUnlinked,
    title: shared.title,
    artist: shared.artist,
    ultimateGuitarUrl: shared.ultimate_guitar_url,
    memorized: row.memorized,
    lastPlayedAt: row.last_played_at,
    lastRatingLabel: row.last_rating_label,
    playCount: row.play_count ?? 0,
    chordChart: (lyricsUnlinked ? row.chord_chart_override : shared.chord_chart) ?? null,
    recordings: row.recordings ?? [],
    tags,
    notApplicableCategories: row.not_applicable_categories ?? [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCategoryRow(row: any): Category {
  return {
    id: row.id,
    name: row.name,
    computed: row.computed,
    guidedPickerEnabled: row.guided_picker_enabled,
    scatterPickerEnabled: row.scatter_picker_enabled,
    values: row.values ?? [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRatingRow(row: any): RatingScaleEntry {
  return { label: row.label, intervalDays: row.interval_days };
}

// Three computed tags, derived at read time (like Staleness) so there's no
// separate write path to keep in sync — they can never drift from
// memorized/lastRatingLabel:
// - "Memorized" is just memorized as a filterable yes/no, independent of
//   how well the song is actually going — lets a Guided Picker step ask
//   "memorized songs only" without also constraining confidence level.
// - A memorized song is always "Great" Performance Confidence (you know it
//   cold regardless of how a read-through would go); its rating instead
//   goes to Memorization Confidence, since that's what you're actually
//   assessing after playing it from memory.
// - An unmemorized song has no Memorization Confidence (not applicable —
//   you're not playing it from memory), and its rating goes to Performance
//   Confidence, since that's what a read-through assesses.
function withComputedTags(song: Song): Song {
  const tags = { ...song.tags };
  tags.memorized = song.memorized ? 'Memorized' : 'Not memorized';

  if (song.memorized) {
    tags.performance_confidence = 'Great';
    if (song.lastRatingLabel) tags.memorization_confidence = song.lastRatingLabel;
    else delete tags.memorization_confidence;
  } else {
    if (song.lastRatingLabel) tags.performance_confidence = song.lastRatingLabel;
    else delete tags.performance_confidence;
    delete tags.memorization_confidence;
  }

  return { ...song, tags };
}

function songFromRow(row: unknown): Song {
  return withComputedTags(mapSongRow(row));
}

function slugify(name: string, existingIds: string[]): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  let id = base || 'category';
  let n = 2;
  while (existingIds.includes(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}

// A cache-write-through on every successful read keeps the offline snapshot
// warm without a separate sync step — whatever the app last saw online is
// what it falls back to if the next load has no connection.
function cachePatch(patch: Partial<{ songs: Song[]; categories: Category[]; ratingScale: RatingScaleEntry[] }>) {
  if (!currentDb) return;
  const current = loadSnapshot(currentDb);
  saveSnapshot(currentDb, {
    songs: current?.songs ?? [],
    categories: current?.categories ?? [],
    ratingScale: current?.ratingScale ?? [],
    ...patch,
  });
}

export function loadCachedSnapshot() {
  return loadSnapshot(currentDb);
}

// Both the admin and viewer app passphrase pass RLS reads, and a wrong one
// isn't rejected with an error (RLS just filters rows to nothing) — this asks
// the database directly which one the current key is, or null if neither.
export async function getAppKeyRole(): Promise<'admin' | 'viewer' | null> {
  const { data, error } = await getSupabaseClient().rpc('app_key_role');
  if (error) throw error;
  return data as 'admin' | 'viewer' | null;
}

// --- Databases ---

export async function listDatabases(): Promise<DatabaseInfo[]> {
  const { data, error } = await getSupabaseClient()
    .from('app_databases')
    .select('id, name, ug_search_fallback')
    .order('name');
  if (error) throw error;
  return data.map((row: { id: string; name: string; ug_search_fallback: boolean }) => ({
    id: row.id,
    name: row.name,
    ugSearchFallback: row.ug_search_fallback,
  }));
}

export async function unlockDatabase(databaseId: string, password: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc('unlock_database', {
    p_db: databaseId,
    p_password: password,
  });
  if (error) throw error;
  return data === true;
}

export async function createDatabase(name: string, password: string, ugSearchFallback: boolean): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('create_database', {
    p_name: name,
    p_password: password,
    p_ug_search: ugSearchFallback,
  });
  if (error) {
    if (error.message === 'NAME_TAKEN') throw new Error('A database with that name already exists.');
    if (error.message === 'NAME_AND_PASSWORD_REQUIRED') throw new Error('A name and a password are both required.');
    throw error;
  }
  return data as string;
}

// --- Songs ---

export async function getSongs(): Promise<Song[]> {
  if (!currentDb) return [];
  const client = getSupabaseClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('db_songs')
      .select(SONG_SELECT)
      .eq('db_id', currentDb)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const songs = rows.map(songFromRow);
  cachePatch({ songs });
  return songs;
}

// Genre is the one category whose value list is global (shared by every
// database), so it's read from global settings rather than the category row.
export async function getGenreValues(): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from('global_settings')
    .select('value')
    .eq('key', 'genre_values')
    .maybeSingle();
  if (error) throw error;
  return (data?.value as string[] | undefined) ?? [];
}

export async function getCategories(): Promise<Category[]> {
  if (!currentDb) return [];
  const [{ data, error }, genreValues] = await Promise.all([
    getSupabaseClient().from('db_categories').select('*').eq('db_id', currentDb).order('sort_order'),
    getGenreValues(),
  ]);
  if (error) throw error;
  const categories = data.map(mapCategoryRow).map((c: Category) =>
    c.id === GENRE_CATEGORY_ID ? { ...c, values: genreValues } : c,
  );
  cachePatch({ categories });
  return categories;
}

export async function getRatingScale(): Promise<RatingScaleEntry[]> {
  const { data, error } = await getSupabaseClient()
    .from('rating_scale')
    .select('*')
    .order('interval_days', { ascending: false });
  if (error) throw error;
  const ratingScale = data.map(mapRatingRow);
  cachePatch({ ratingScale });
  return ratingScale;
}

async function performRate(songId: string, ratingLabel: string): Promise<Song> {
  // Goes through the rate_db_song function (not a plain update) so play_count
  // increments atomically server-side, regardless of which UI path — or
  // how many concurrent calls — triggered the rating.
  const { data, error } = await getSupabaseClient().rpc('rate_db_song', {
    p_song_id: songId,
    p_rating_label: ratingLabel,
  });
  if (error) throw error;
  return songFromRow(data);
}

async function performSetMemorized(songId: string, memorized: boolean): Promise<Song> {
  const { data, error } = await getSupabaseClient()
    .from('db_songs')
    .update({ memorized })
    .eq('id', songId)
    .select(SONG_SELECT)
    .single();
  if (error) throw error;
  return songFromRow(data);
}

// What a song will look like once a rating/memorized change lands, so the UI
// can show it immediately while the real write is still in flight.
export function previewSongChange(song: Song, patch: Partial<Song>): Song {
  return withComputedTags({ ...song, ...patch });
}

function optimisticSong(songId: string, patch: Partial<Song>): Song | null {
  const cached = loadSnapshot(currentDb);
  const existing = cached?.songs.find((s) => s.id === songId);
  if (!existing) return null;
  const updated = withComputedTags({ ...existing, ...patch });
  updateCachedSong(updated);
  return updated;
}

export async function rateSong(songId: string, ratingLabel: string): Promise<Song> {
  try {
    const song = await performRate(songId, ratingLabel);
    updateCachedSong(song);
    return song;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = loadSnapshot(currentDb);
    const existingPlayCount = cached?.songs.find((s) => s.id === songId)?.playCount ?? 0;
    const optimistic = optimisticSong(songId, {
      lastPlayedAt: new Date().toISOString(),
      lastRatingLabel: ratingLabel,
      playCount: existingPlayCount + 1,
    });
    if (!optimistic) throw err;
    enqueuePendingWrite({ type: 'rate', dbId: currentDb, songId, ratingLabel });
    return optimistic;
  }
}

export async function setMemorized(songId: string, memorized: boolean): Promise<Song> {
  try {
    const song = await performSetMemorized(songId, memorized);
    updateCachedSong(song);
    return song;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const optimistic = optimisticSong(songId, { memorized });
    if (!optimistic) throw err;
    enqueuePendingWrite({ type: 'memorized', dbId: currentDb, songId, memorized });
    return optimistic;
  }
}

// Replays queued offline ratings/memorized-toggles for the open database, in
// order. Stops at the first failure (still offline) rather than reordering —
// the rest stay queued for the next attempt. Writes queued for a different
// database stay put until that database is open again.
export async function syncPendingWrites(): Promise<{ synced: number; remaining: number }> {
  const queue = getPendingWrites().filter((op) => op.dbId === currentDb);
  let synced = 0;
  for (const op of queue) {
    try {
      if (op.type === 'rate') {
        const song = await performRate(op.songId, op.ratingLabel);
        updateCachedSong(song);
      } else {
        const song = await performSetMemorized(op.songId, op.memorized);
        updateCachedSong(song);
      }
      removePendingWrite(op.id);
      synced += 1;
    } catch (err) {
      if (isNetworkError(err)) break;
      // A non-network failure (e.g. the song was removed) — drop it rather
      // than block every write behind it forever.
      removePendingWrite(op.id);
    }
  }
  return { synced, remaining: pendingWriteCount() };
}

export function pendingWriteCount(): number {
  return getPendingWrites().filter((op) => op.dbId === currentDb).length;
}

// "Memorized" is backed by the real memorized boolean, not a raw tag —
// withComputedTags regenerates tags.memorized from it on every read, so a
// generic tag write here would just get silently overwritten. Callers must
// route memorized-category writes through setMemorized instead. Genre is
// handled server-side: it lives on the shared song (or, for a database that
// doesn't own the song, becomes that database's own unlinked value).
export async function updateSongTag(songId: string, categoryId: string, value: TagValue | null): Promise<Song> {
  const client = getSupabaseClient();
  const { data, error } =
    value == null
      ? await client.rpc('delete_db_song_tag', { p_song_id: songId, p_category_id: categoryId })
      : await client.rpc('update_db_song_tag', { p_song_id: songId, p_category_id: categoryId, p_value: value });
  if (error) throw error;
  return songFromRow(data);
}

async function setNotApplicableCategories(songId: string, next: string[]): Promise<Song> {
  const { data, error } = await getSupabaseClient()
    .from('db_songs')
    .update({ not_applicable_categories: next })
    .eq('id', songId)
    .select(SONG_SELECT)
    .single();
  if (error) throw error;
  const song = songFromRow(data);
  updateCachedSong(song);
  return song;
}

export async function markCategoryNotApplicable(song: Song, categoryId: string): Promise<Song> {
  const next = Array.from(new Set([...song.notApplicableCategories, categoryId]));
  return setNotApplicableCategories(song.id, next);
}

export async function clearNotApplicable(song: Song, categoryId: string): Promise<Song> {
  const next = song.notApplicableCategories.filter((id) => id !== categoryId);
  return setNotApplicableCategories(song.id, next);
}

// --- Adding songs: the shared library, duplicates, and importing ---

export interface SongMatch {
  sharedSongId: string;
  title: string;
  artist: string;
  ultimateGuitarUrl: string;
  // Whether the open database already has this song.
  inDatabase: boolean;
  reason: string;
}

// Thrown by createSong. 'exact' can never be overridden (use the existing
// song); 'similar' can be, once the user confirms the new song really is
// different.
export class DuplicateSongError extends Error {
  kind: 'exact' | 'similar';
  matches: SongMatch[];
  constructor(kind: 'exact' | 'similar', matches: SongMatch[]) {
    super(kind === 'exact' ? 'DUPLICATE_EXACT' : 'DUPLICATE_SIMILAR');
    this.kind = kind;
    this.matches = matches;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMatch(row: any): SongMatch {
  return {
    sharedSongId: row.shared_song_id,
    title: row.title,
    artist: row.artist,
    ultimateGuitarUrl: row.ultimate_guitar_url,
    inDatabase: row.in_database,
    reason: row.reason,
  };
}

// The "does this sound like something we already have?" check, without
// creating anything — used to warn while typing as well as on save.
export async function findSongMatches(
  title: string,
  artist: string,
  url: string,
): Promise<{ exact: SongMatch[]; similar: SongMatch[] }> {
  const { data, error } = await getSupabaseClient().rpc('find_song_matches', {
    p_title: title,
    p_artist: artist,
    p_url: url,
  });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data as any[];
  return {
    exact: rows.filter((r) => r.tier === 'exact').map(mapMatch),
    similar: rows.filter((r) => r.tier === 'similar').map(mapMatch),
  };
}

export async function createSong(
  input: {
    title: string;
    artist: string;
    ultimateGuitarUrl: string;
    chordChart?: string;
    tags: Record<string, TagValue>;
  },
  confirmedDifferent = false,
): Promise<Song[]> {
  const { error } = await getSupabaseClient().rpc('create_song', {
    p_title: input.title,
    p_artist: input.artist,
    p_url: input.ultimateGuitarUrl,
    p_lyrics: input.chordChart ?? '',
    p_tags: input.tags,
    p_confirmed: confirmedDifferent,
  });
  if (error) {
    if (error.message === 'DUPLICATE_EXACT' || error.message === 'DUPLICATE_SIMILAR') {
      const matches = (JSON.parse(error.details ?? '[]') as unknown[]).map(mapMatch);
      throw new DuplicateSongError(error.message === 'DUPLICATE_EXACT' ? 'exact' : 'similar', matches);
    }
    throw error;
  }
  return getSongs();
}

export interface LibrarySong {
  sharedSongId: string;
  title: string;
  artist: string;
  ultimateGuitarUrl: string;
  inDatabase: boolean;
}

// Search the shared library (every song any database has ever added) so a
// song that already exists can be brought into this database instead of
// being created again.
export async function searchLibrary(query: string): Promise<LibrarySong[]> {
  const q = query.replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 2) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('shared_songs')
    .select('id, title, artist, ultimate_guitar_url')
    .or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
    .order('title')
    .limit(30);
  if (error) throw error;
  if (data.length === 0) return [];

  const { data: mine, error: mineError } = await client
    .from('db_songs')
    .select('shared_song_id')
    .eq('db_id', currentDb)
    .in(
      'shared_song_id',
      data.map((s: { id: string }) => s.id),
    );
  if (mineError) throw mineError;
  const have = new Set(mine.map((r: { shared_song_id: string }) => r.shared_song_id));

  return data.map((s: { id: string; title: string; artist: string; ultimate_guitar_url: string }) => ({
    sharedSongId: s.id,
    title: s.title,
    artist: s.artist,
    ultimateGuitarUrl: s.ultimate_guitar_url,
    inDatabase: have.has(s.id),
  }));
}

// Brings an existing shared song into the open database with only the bare
// essentials — no tags and no stats carry over from any other database.
export async function addLibrarySong(sharedSongId: string): Promise<Song[]> {
  const { error } = await getSupabaseClient()
    .from('db_songs')
    .insert({ db_id: currentDb, shared_song_id: sharedSongId });
  if (error) throw error;
  return getSongs();
}

// --- Editing a song ---

async function fetchSong(songId: string): Promise<Song> {
  const { data, error } = await getSupabaseClient()
    .from('db_songs')
    .select(SONG_SELECT)
    .eq('id', songId)
    .single();
  if (error) throw error;
  return songFromRow(data);
}

// Title, artist and link belong to the shared song, so only the database that
// owns it can change them (row security enforces this; a non-owner's update
// matches nothing).
async function updateSharedFields(
  song: Song,
  fields: { title?: string; artist?: string; ultimate_guitar_url?: string },
): Promise<Song> {
  const { data, error } = await getSupabaseClient()
    .from('shared_songs')
    .update(fields)
    .eq('id', song.sharedSongId)
    .select('id');
  if (error) {
    if (error.code === '23505') throw new Error('Another song in the library already has that title and artist (or link).');
    throw error;
  }
  if (data.length === 0) throw new Error('Only the database that created this song can change its title, artist, or link.');
  return fetchSong(song.id);
}

export async function updateSongUrl(song: Song, url: string): Promise<Song> {
  return updateSharedFields(song, { ultimate_guitar_url: url.trim() });
}

export async function updateSongTitleArtist(song: Song, title: string, artist: string): Promise<Song> {
  return updateSharedFields(song, { title: title.trim(), artist: artist.trim() });
}

export async function updateChordChart(songId: string, chordChart: string): Promise<Song> {
  const { data, error } = await getSupabaseClient().rpc('set_db_song_lyrics', {
    p_song_id: songId,
    p_text: chordChart,
  });
  if (error) throw error;
  return songFromRow(data);
}

// 'lyrics' or 'genre': stop following the shared value and keep this
// database's own; relinking throws the local version away.
export async function unlinkSongField(songId: string, field: 'lyrics' | 'genre'): Promise<Song> {
  const { data, error } = await getSupabaseClient().rpc('unlink_db_song_field', {
    p_song_id: songId,
    p_field: field,
  });
  if (error) throw error;
  return songFromRow(data);
}

export async function relinkSongField(songId: string, field: 'lyrics' | 'genre'): Promise<Song> {
  const { data, error } = await getSupabaseClient().rpc('relink_db_song_field', {
    p_song_id: songId,
    p_field: field,
  });
  if (error) throw error;
  return songFromRow(data);
}

async function fetchRecordings(
  client: ReturnType<typeof getSupabaseClient>,
  songId: string,
): Promise<SongRecording[]> {
  const { data, error } = await client.from('db_songs').select('recordings').eq('id', songId).single();
  if (error) throw error;
  return (data.recordings ?? []) as SongRecording[];
}

async function writeRecordings(
  client: ReturnType<typeof getSupabaseClient>,
  songId: string,
  recordings: SongRecording[],
): Promise<Song> {
  const { data, error } = await client
    .from('db_songs')
    .update({ recordings })
    .eq('id', songId)
    .select(SONG_SELECT)
    .single();
  if (error) throw error;
  return songFromRow(data);
}

// No cap, and no reordering — recordings just stay in the order they were
// added. They belong to this database's entry, not the shared song. Each gets
// its own object at {songId}/{recordingId} in the shared "audio" bucket.
export async function addSongRecording(songId: string, title: string, file: File): Promise<Song> {
  const client = getSupabaseClient();
  const recordingId = crypto.randomUUID();
  const path = `${songId}/${recordingId}`;

  const { error: uploadError } = await client.storage
    .from('audio')
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (uploadError) throw uploadError;

  const existing = await fetchRecordings(client, songId);
  return writeRecordings(client, songId, [...existing, { id: recordingId, title: title.trim(), path }]);
}

export async function renameSongRecording(songId: string, recordingId: string, title: string): Promise<Song> {
  const client = getSupabaseClient();
  const existing = await fetchRecordings(client, songId);
  return writeRecordings(
    client,
    songId,
    existing.map((r) => (r.id === recordingId ? { ...r, title: title.trim() } : r)),
  );
}

export async function removeSongRecording(songId: string, recordingId: string): Promise<Song> {
  const client = getSupabaseClient();
  const existing = await fetchRecordings(client, songId);
  const target = existing.find((r) => r.id === recordingId);
  if (target) {
    const { error: removeError } = await client.storage.from('audio').remove([target.path]);
    if (removeError) throw removeError;
  }
  return writeRecordings(
    client,
    songId,
    existing.filter((r) => r.id !== recordingId),
  );
}

// Storage RLS gates the download the same way it gates every table read, so
// this can't just be a public URL — the blob is fetched through an
// authenticated request and handed back as a local object URL. Callers own
// revoking it (URL.revokeObjectURL) once they're done with it.
export async function getSongAudioUrl(audioPath: string): Promise<string> {
  const { data, error } = await getSupabaseClient().storage.from('audio').download(audioPath);
  if (error) throw error;
  return URL.createObjectURL(data);
}

// Removes the song from the open database only. The shared song stays for any
// other database that uses it (and passes to one of them if this database
// owned it); it is deleted only when nothing uses it any more. This
// database's recordings of it go with the entry.
export async function removeSongFromDatabase(song: Song): Promise<Song[]> {
  const client = getSupabaseClient();
  const { error } = await client.rpc('remove_db_song', { p_song_id: song.id });
  if (error) throw error;
  if (song.recordings.length > 0) {
    await client.storage.from('audio').remove(song.recordings.map((r) => r.path));
  }
  return getSongs();
}

// --- Settings: category management ---

export async function addCategory(name: string): Promise<Category[]> {
  const client = getSupabaseClient();
  const { data: existing, error: fetchError } = await client
    .from('db_categories')
    .select('id, sort_order')
    .eq('db_id', currentDb);
  if (fetchError) throw fetchError;

  const id = slugify(
    name,
    existing.map((c: { id: string }) => c.id),
  );
  const nextSortOrder =
    existing.length > 0 ? Math.max(...existing.map((c: { sort_order: number }) => c.sort_order)) + 1 : 0;

  // "type" is a legacy required DB column (single/multi/range) from before
  // every category was single-select — always 'single' now, and no longer
  // modeled on the app side.
  const { error: insertError } = await client.from('db_categories').insert({
    id,
    db_id: currentDb,
    name: name.trim(),
    type: 'single',
    computed: false,
    guided_picker_enabled: true,
    sort_order: nextSortOrder,
  });
  if (insertError) throw insertError;
  return getCategories();
}

export async function renameCategory(categoryId: string, name: string): Promise<Category[]> {
  const { error } = await getSupabaseClient()
    .from('db_categories')
    .update({ name: name.trim() })
    .eq('id', categoryId)
    .eq('db_id', currentDb);
  if (error) throw error;
  return getCategories();
}

// Retiring drops the category from the active list — Guided Picker, Filters,
// Sort, and the tag editor all stop offering it. Songs keep whatever value
// they already had under that key; nothing touches song data, matching the
// JSONB "a key nobody reads is just inert" model.
export async function retireCategory(categoryId: string): Promise<Category[]> {
  const { error } = await getSupabaseClient()
    .from('db_categories')
    .delete()
    .eq('id', categoryId)
    .eq('db_id', currentDb);
  if (error) throw error;
  return getCategories();
}

export async function reorderCategories(orderedIds: string[]): Promise<Category[]> {
  const client = getSupabaseClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      client.from('db_categories').update({ sort_order: index }).eq('id', id).eq('db_id', currentDb),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return getCategories();
}

export async function setCategoryGuidedPickerEnabled(categoryId: string, enabled: boolean): Promise<Category[]> {
  const { error } = await getSupabaseClient()
    .from('db_categories')
    .update({ guided_picker_enabled: enabled })
    .eq('id', categoryId)
    .eq('db_id', currentDb);
  if (error) throw error;
  return getCategories();
}

export async function setCategoryScatterPickerEnabled(categoryId: string, enabled: boolean): Promise<Category[]> {
  const { error } = await getSupabaseClient()
    .from('db_categories')
    .update({ scatter_picker_enabled: enabled })
    .eq('id', categoryId)
    .eq('db_id', currentDb);
  if (error) throw error;
  return getCategories();
}

async function setGenreValues(values: string[]): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('global_settings')
    .upsert({ key: 'genre_values', value: values });
  if (error) throw error;
}

// Registers a value on the category itself (Settings' "Values" screen has no
// song to attach a brand-new value to) — merged with whatever songs already
// carry wherever categoryValues() is read, so a pre-registered value is
// immediately selectable everywhere without requiring a song to be tagged
// with it first. Genre's list is global, so it's stored in global settings.
export async function addCategoryValue(categoryId: string, value: string): Promise<Category[]> {
  const client = getSupabaseClient();
  const trimmed = value.trim();
  if (categoryId === GENRE_CATEGORY_ID) {
    await setGenreValues(Array.from(new Set([...(await getGenreValues()), trimmed])));
    return getCategories();
  }
  const { data: existing, error: fetchError } = await client
    .from('db_categories')
    .select('values')
    .eq('id', categoryId)
    .eq('db_id', currentDb)
    .single();
  if (fetchError) throw fetchError;

  const nextValues = Array.from(new Set([...(existing.values ?? []), trimmed]));
  const { error } = await client
    .from('db_categories')
    .update({ values: nextValues })
    .eq('id', categoryId)
    .eq('db_id', currentDb);
  if (error) throw error;
  return getCategories();
}

// Overwrites the registered value list's order outright (unlike
// addCategoryValue/updateRegisteredValues, which only ever append or filter)
// — categoryValues() treats this array's order as the display order
// everywhere, so this is the one write path a plain reorder needs.
export async function reorderCategoryValues(categoryId: string, orderedValues: string[]): Promise<Category[]> {
  if (categoryId === GENRE_CATEGORY_ID) {
    await setGenreValues(orderedValues);
    return getCategories();
  }
  const { error } = await getSupabaseClient()
    .from('db_categories')
    .update({ values: orderedValues })
    .eq('id', categoryId)
    .eq('db_id', currentDb);
  if (error) throw error;
  return getCategories();
}

async function updateRegisteredValues(
  client: ReturnType<typeof getSupabaseClient>,
  categoryId: string,
  transform: (values: string[]) => string[],
) {
  const { data: existing, error: fetchError } = await client
    .from('db_categories')
    .select('values')
    .eq('id', categoryId)
    .eq('db_id', currentDb)
    .single();
  if (fetchError) throw fetchError;
  const { error } = await client
    .from('db_categories')
    .update({ values: transform(existing.values ?? []) })
    .eq('id', categoryId)
    .eq('db_id', currentDb);
  if (error) throw error;
}

export async function renameCategoryValue(
  categoryId: string,
  oldValue: string,
  newValue: string,
): Promise<{ songs: Song[]; categories: Category[] }> {
  const client = getSupabaseClient();

  if (categoryId === GENRE_CATEGORY_ID) {
    // Genre values are global: the rename has to reach every database.
    const { error } = await client.rpc('rename_genre_value', { p_old: oldValue, p_new: newValue });
    if (error) throw error;
    const [songs, categories] = await Promise.all([getSongs(), getCategories()]);
    return { songs, categories };
  }

  // Scoped to this database — another database may define a category with the
  // same id, and a rename here has nothing to do with it.
  const { data, error } = await client.from('db_songs').select('id, tags').eq('db_id', currentDb);
  if (error) throw error;

  const writes = data.flatMap((row: { id: string; tags: Record<string, TagValue> }) => {
    const v = row.tags?.[categoryId];
    if (v !== oldValue) return [];
    return [client.rpc('update_db_song_tag', { p_song_id: row.id, p_category_id: categoryId, p_value: newValue })];
  });

  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;

  await updateRegisteredValues(client, categoryId, (values) =>
    values.map((v) => (v === oldValue ? newValue : v)),
  );

  const [songs, categories] = await Promise.all([getSongs(), getCategories()]);
  return { songs, categories };
}

export async function deleteCategoryValue(
  categoryId: string,
  value: string,
): Promise<{ songs: Song[]; categories: Category[] }> {
  const client = getSupabaseClient();

  if (categoryId === GENRE_CATEGORY_ID) {
    const { error } = await client.rpc('delete_genre_value', { p_value: value });
    if (error) throw error;
    const [songs, categories] = await Promise.all([getSongs(), getCategories()]);
    return { songs, categories };
  }

  const { data, error } = await client.from('db_songs').select('id, tags').eq('db_id', currentDb);
  if (error) throw error;

  const writes = data.flatMap((row: { id: string; tags: Record<string, TagValue> }) => {
    const v = row.tags?.[categoryId];
    if (v !== value) return [];
    return [client.rpc('delete_db_song_tag', { p_song_id: row.id, p_category_id: categoryId })];
  });

  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;

  await updateRegisteredValues(client, categoryId, (values) => values.filter((v) => v !== value));

  const [songs, categories] = await Promise.all([getSongs(), getCategories()]);
  return { songs, categories };
}

// --- Global settings: rating scale (shared by every database) ---

export async function addRatingEntry(label: string, intervalDays: number): Promise<RatingScaleEntry[]> {
  const { error } = await getSupabaseClient()
    .from('rating_scale')
    .insert({ label: label.trim(), interval_days: intervalDays });
  if (error) throw error;
  return getRatingScale();
}

export async function updateRatingEntry(
  oldLabel: string,
  next: RatingScaleEntry,
): Promise<{ ratingScale: RatingScaleEntry[]; songs: Song[] }> {
  const client = getSupabaseClient();
  const trimmedLabel = next.label.trim();

  const { error: updateError } = await client
    .from('rating_scale')
    .update({ label: trimmedLabel, interval_days: next.intervalDays })
    .eq('label', oldLabel);
  if (updateError) throw updateError;

  if (trimmedLabel !== oldLabel) {
    // Songs in every database carry the label, so the rename must reach all
    // of them, not just the open one.
    const { error: cascadeError } = await client.rpc('rename_rating_label', {
      p_old: oldLabel,
      p_new: trimmedLabel,
    });
    if (cascadeError) throw cascadeError;
  }

  const ratingScale = await getRatingScale();
  const songs = currentDb ? await getSongs() : [];
  return { ratingScale, songs };
}

export async function removeRatingEntry(label: string): Promise<RatingScaleEntry[]> {
  const { error } = await getSupabaseClient().from('rating_scale').delete().eq('label', label);
  if (error) throw error;
  return getRatingScale();
}

// --- Playlists ---
// Saved, named, reordered song lists — an extension of the ephemeral queue
// (which stays local-only). Scoped to the open database. db_playlist_songs is
// the join table holding order and leader (see the migration for why those
// can't live on the song itself).

export async function getPlaylists(): Promise<PlaylistSummary[]> {
  if (!currentDb) return [];
  const client = getSupabaseClient();
  const { data: playlists, error } = await client
    .from('db_playlists')
    .select('id, name, created_at, show_date')
    .eq('db_id', currentDb)
    .order('show_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (playlists.length === 0) return [];

  const { data: songRows, error: songsError } = await client
    .from('db_playlist_songs')
    .select('playlist_id')
    .in(
      'playlist_id',
      playlists.map((p: { id: string }) => p.id),
    );
  if (songsError) throw songsError;

  const counts = new Map<string, number>();
  for (const row of songRows as { playlist_id: string }[]) {
    counts.set(row.playlist_id, (counts.get(row.playlist_id) ?? 0) + 1);
  }

  return playlists.map((p: { id: string; name: string; created_at: string; show_date: string | null }) => ({
    id: p.id,
    name: p.name,
    songCount: counts.get(p.id) ?? 0,
    createdAt: p.created_at,
    showDate: p.show_date,
  }));
}

// Every playlist in the open database with every song that has appeared on
// at least one of them — the raw material for the playlist history matrix.
export async function getPlaylistHistory(): Promise<PlaylistHistory> {
  const client = getSupabaseClient();
  const { data: playlists, error } = await client
    .from('db_playlists')
    .select('id, name, show_date')
    .eq('db_id', currentDb)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (playlists.length === 0) return { playlists: [], songs: [], appearances: [] };

  const { data, error: rowsError } = await client
    .from('db_playlist_songs')
    .select('playlist_id, song_id, leader, sort_order, db_songs(shared_songs(title, artist))')
    .in(
      'playlist_id',
      playlists.map((p: { id: string }) => p.id),
    );
  if (rowsError) throw rowsError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data as any[];
  const songsById = new Map<string, { songId: string; title: string; artist: string }>();
  for (const row of rows) {
    const shared = row.db_songs.shared_songs;
    songsById.set(row.song_id, { songId: row.song_id, title: shared.title, artist: shared.artist });
  }

  return {
    playlists: playlists.map((p: { id: string; name: string; show_date: string | null }) => ({
      id: p.id,
      name: p.name,
      showDate: p.show_date,
    })),
    songs: [...songsById.values()].sort((a, b) => a.title.localeCompare(b.title)),
    appearances: rows.map((row) => ({
      playlistId: row.playlist_id,
      songId: row.song_id,
      leader: row.leader,
      position: row.sort_order + 1,
    })),
  };
}

export async function getPlaylistDetail(playlistId: string): Promise<PlaylistDetail> {
  const client = getSupabaseClient();
  const [playlistResult, songsResult] = await Promise.all([
    client.from('db_playlists').select('id, name, show_date').eq('id', playlistId).single(),
    client
      .from('db_playlist_songs')
      .select('song_id, leader, db_songs(shared_songs(title, artist))')
      .eq('playlist_id', playlistId)
      .order('sort_order'),
  ]);
  if (playlistResult.error) throw playlistResult.error;
  if (songsResult.error) throw songsResult.error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = songsResult.data as any[];
  return {
    id: playlistResult.data.id,
    name: playlistResult.data.name,
    showDate: playlistResult.data.show_date,
    songs: rows.map((row) => ({
      songId: row.song_id,
      title: row.db_songs.shared_songs.title,
      artist: row.db_songs.shared_songs.artist,
      leader: row.leader,
    })),
  };
}

export async function createPlaylistFromQueue(
  name: string,
  entries: QueueEntry[],
  showDate: string | null,
): Promise<string> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('db_playlists')
    .insert({ name: name.trim(), db_id: currentDb, show_date: showDate })
    .select()
    .single();
  if (error) throw error;

  if (entries.length > 0) {
    const { error: songsError } = await client.from('db_playlist_songs').insert(
      entries.map((entry, index) => ({
        playlist_id: data.id,
        song_id: entry.songId,
        sort_order: index,
        leader: entry.leader,
      })),
    );
    if (songsError) throw songsError;
  }
  return data.id as string;
}

// Wholesale replace — used to "update" a playlist from an edited, re-saved
// queue. Delete-then-insert rather than a diff; simple, and fine for a
// single-admin app.
export async function setPlaylistSongs(playlistId: string, entries: QueueEntry[]): Promise<void> {
  const client = getSupabaseClient();
  const { error: deleteError } = await client.from('db_playlist_songs').delete().eq('playlist_id', playlistId);
  if (deleteError) throw deleteError;

  if (entries.length === 0) return;
  const { error: insertError } = await client.from('db_playlist_songs').insert(
    entries.map((entry, index) => ({
      playlist_id: playlistId,
      song_id: entry.songId,
      sort_order: index,
      leader: entry.leader,
    })),
  );
  if (insertError) throw insertError;
}

export async function renamePlaylist(playlistId: string, name: string): Promise<void> {
  const { error } = await getSupabaseClient().from('db_playlists').update({ name: name.trim() }).eq('id', playlistId);
  if (error) throw error;
}

export async function setPlaylistShowDate(playlistId: string, showDate: string | null): Promise<void> {
  const { error } = await getSupabaseClient().from('db_playlists').update({ show_date: showDate }).eq('id', playlistId);
  if (error) throw error;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  // db_playlist_songs rows cascade-delete via the foreign key.
  const { error } = await getSupabaseClient().from('db_playlists').delete().eq('id', playlistId);
  if (error) throw error;
}

// Appends at the end; a no-op if the song is already in the playlist
// (silently, rather than erroring on the composite-key conflict) so the
// Results-row picker and the tag editor's own search can both call this
// without worrying about duplicates.
export async function addSongToPlaylist(playlistId: string, songId: string): Promise<void> {
  const client = getSupabaseClient();
  const { data: existing, error: fetchError } = await client
    .from('db_playlist_songs')
    .select('song_id, sort_order')
    .eq('playlist_id', playlistId);
  if (fetchError) throw fetchError;
  if (existing.some((row: { song_id: string }) => row.song_id === songId)) return;

  const nextSortOrder =
    existing.length > 0 ? Math.max(...existing.map((row: { sort_order: number }) => row.sort_order)) + 1 : 0;
  const { error } = await client
    .from('db_playlist_songs')
    .insert({ playlist_id: playlistId, song_id: songId, sort_order: nextSortOrder, leader: null });
  if (error) throw error;
}

export async function removeSongFromPlaylist(playlistId: string, songId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('db_playlist_songs')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('song_id', songId);
  if (error) throw error;
}

export async function setPlaylistSongLeader(
  playlistId: string,
  songId: string,
  leader: string | null,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('db_playlist_songs')
    .update({ leader })
    .eq('playlist_id', playlistId)
    .eq('song_id', songId);
  if (error) throw error;
}

export async function reorderPlaylistSongs(playlistId: string, orderedSongIds: string[]): Promise<void> {
  const client = getSupabaseClient();
  const results = await Promise.all(
    orderedSongIds.map((songId, index) =>
      client
        .from('db_playlist_songs')
        .update({ sort_order: index })
        .eq('playlist_id', playlistId)
        .eq('song_id', songId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// --- Playlist leaders (per database) ---

export async function getPlaylistLeaders(): Promise<string[]> {
  if (!currentDb) return [];
  const { data, error } = await getSupabaseClient()
    .from('db_playlist_leaders')
    .select('name')
    .eq('db_id', currentDb)
    .order('sort_order');
  if (error) throw error;
  return data.map((row: { name: string }) => row.name);
}

export async function addPlaylistLeader(name: string): Promise<string[]> {
  const client = getSupabaseClient();
  const { data: existing, error: fetchError } = await client
    .from('db_playlist_leaders')
    .select('sort_order')
    .eq('db_id', currentDb);
  if (fetchError) throw fetchError;
  const nextSortOrder =
    existing.length > 0 ? Math.max(...existing.map((row: { sort_order: number }) => row.sort_order)) + 1 : 0;
  const { error } = await client
    .from('db_playlist_leaders')
    .insert({ db_id: currentDb, name: name.trim(), sort_order: nextSortOrder });
  if (error) throw error;
  return getPlaylistLeaders();
}

export async function renamePlaylistLeader(oldName: string, newName: string): Promise<string[]> {
  const client = getSupabaseClient();
  const trimmed = newName.trim();
  const { error } = await client
    .from('db_playlist_leaders')
    .update({ name: trimmed })
    .eq('db_id', currentDb)
    .eq('name', oldName);
  if (error) throw error;

  // Playlist rows are scoped to the open database by row security, so this
  // only ever touches this database's playlists.
  const { error: cascadeError } = await client
    .from('db_playlist_songs')
    .update({ leader: trimmed })
    .eq('leader', oldName);
  if (cascadeError) throw cascadeError;

  return getPlaylistLeaders();
}

export async function removePlaylistLeader(name: string): Promise<string[]> {
  const client = getSupabaseClient();
  const { error } = await client.from('db_playlist_leaders').delete().eq('db_id', currentDb).eq('name', name);
  if (error) throw error;

  const { error: cascadeError } = await client
    .from('db_playlist_songs')
    .update({ leader: null })
    .eq('leader', name);
  if (cascadeError) throw cascadeError;

  return getPlaylistLeaders();
}

export async function reorderPlaylistLeaders(orderedNames: string[]): Promise<string[]> {
  const client = getSupabaseClient();
  const results = await Promise.all(
    orderedNames.map((name, index) =>
      client
        .from('db_playlist_leaders')
        .update({ sort_order: index })
        .eq('db_id', currentDb)
        .eq('name', name),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return getPlaylistLeaders();
}
