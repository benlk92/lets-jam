import type {
  Category,
  PlaylistDetail,
  PlaylistSummary,
  QueueEntry,
  RatingScaleEntry,
  Song,
  SongRecording,
  Space,
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

// Supabase-backed implementation of the data-access layer. Every screen
// talks to this module only — this file is the entire surface area that
// changed when the app moved off in-memory fixtures onto the real database.

// Which space every read/write below is scoped to — set by the app once at
// startup and again on every space switch (see App.tsx). Not a security
// boundary (RLS doesn't check it); just which rows the client asks for.
let currentSpace: Space = 'pop_songs';

export function setCurrentSpace(space: Space) {
  currentSpace = space;
}

export function getCurrentSpace(): Space {
  return currentSpace;
}

function updateCachedSong(song: Song) {
  updateCachedSongIn(currentSpace, song);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSongRow(row: any): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    ultimateGuitarUrl: row.ultimate_guitar_url,
    memorized: row.memorized,
    lastPlayedAt: row.last_played_at,
    lastRatingLabel: row.last_rating_label,
    playCount: row.play_count ?? 0,
    chordChart: row.chord_chart ?? null,
    recordings: row.recordings ?? [],
    tags: row.tags ?? {},
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
  const current = loadSnapshot(currentSpace);
  saveSnapshot(currentSpace, {
    songs: current?.songs ?? [],
    categories: current?.categories ?? [],
    ratingScale: current?.ratingScale ?? [],
    ...patch,
  });
}

export function loadCachedSnapshot() {
  return loadSnapshot(currentSpace);
}

// Both the admin and viewer passphrase pass RLS reads, so "categories came
// back non-empty" (used to validate the passphrase itself) can't tell them
// apart — this asks the database directly which one the current key is.
export async function getAppKeyRole(): Promise<'admin' | 'viewer' | null> {
  const { data, error } = await getSupabaseClient().rpc('app_key_role');
  if (error) throw error;
  return data as 'admin' | 'viewer' | null;
}

export async function getSongs(): Promise<Song[]> {
  const { data, error } = await getSupabaseClient().from('songs').select('*').eq('space', currentSpace);
  if (error) throw error;
  const songs = data.map(mapSongRow).map(withComputedTags);
  cachePatch({ songs });
  return songs;
}

export async function getCategories(): Promise<Category[]> {
  const { data, error } = await getSupabaseClient()
    .from('categories')
    .select('*')
    .eq('space', currentSpace)
    .order('sort_order');
  if (error) throw error;
  const categories = data.map(mapCategoryRow);
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
  // Goes through the rate_song RPC (not a plain update) so play_count
  // increments atomically server-side, regardless of which UI path — or
  // how many concurrent calls — triggered the rating.
  const { data, error } = await getSupabaseClient().rpc('rate_song', {
    p_song_id: songId,
    p_rating_label: ratingLabel,
  });
  if (error) throw error;
  return withComputedTags(mapSongRow(data));
}

async function performSetMemorized(songId: string, memorized: boolean): Promise<Song> {
  const { data, error } = await getSupabaseClient()
    .from('songs')
    .update({ memorized })
    .eq('id', songId)
    .select()
    .single();
  if (error) throw error;
  return withComputedTags(mapSongRow(data));
}

function optimisticSong(songId: string, patch: Partial<Song>): Song | null {
  const cached = loadSnapshot(currentSpace);
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
    const cached = loadSnapshot(currentSpace);
    const existingPlayCount = cached?.songs.find((s) => s.id === songId)?.playCount ?? 0;
    const optimistic = optimisticSong(songId, {
      lastPlayedAt: new Date().toISOString(),
      lastRatingLabel: ratingLabel,
      playCount: existingPlayCount + 1,
    });
    if (!optimistic) throw err;
    enqueuePendingWrite({ type: 'rate', songId, ratingLabel });
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
    enqueuePendingWrite({ type: 'memorized', songId, memorized });
    return optimistic;
  }
}

// Replays queued offline ratings/memorized-toggles in order. Stops at the
// first failure (still offline) rather than reordering — the rest stay
// queued for the next attempt.
export async function syncPendingWrites(): Promise<{ synced: number; remaining: number }> {
  const queue = getPendingWrites();
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
      // A non-network failure (e.g. the song was deleted) — drop it rather
      // than block every write behind it forever.
      removePendingWrite(op.id);
    }
  }
  return { synced, remaining: getPendingWrites().length };
}

export function pendingWriteCount(): number {
  return getPendingWrites().length;
}

// "Memorized" is backed by the real memorized boolean, not a raw tag —
// withComputedTags regenerates tags.memorized from it on every read, so a
// generic tag write here would just get silently overwritten. Callers must
// route memorized-category writes through setMemorized instead.
export async function updateSongTag(songId: string, categoryId: string, value: TagValue | null): Promise<Song> {
  const client = getSupabaseClient();
  const { data, error } =
    value == null
      ? await client.rpc('delete_song_tag', { p_song_id: songId, p_category_id: categoryId })
      : await client.rpc('update_song_tag', { p_song_id: songId, p_category_id: categoryId, p_value: value });
  if (error) throw error;
  return withComputedTags(mapSongRow(data));
}

async function setNotApplicableCategories(songId: string, next: string[]): Promise<Song> {
  const { data, error } = await getSupabaseClient()
    .from('songs')
    .update({ not_applicable_categories: next })
    .eq('id', songId)
    .select()
    .single();
  if (error) throw error;
  const song = withComputedTags(mapSongRow(data));
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

export async function addSong(input: {
  title: string;
  artist: string;
  ultimateGuitarUrl: string;
  chordChart?: string;
  tags: Record<string, TagValue>;
}): Promise<Song[]> {
  const { error } = await getSupabaseClient().from('songs').insert({
    title: input.title.trim(),
    artist: input.artist.trim(),
    ultimate_guitar_url: input.ultimateGuitarUrl.trim(),
    chord_chart: input.chordChart?.trim() || null,
    tags: input.tags,
    space: currentSpace,
  });
  if (error) throw error;
  return getSongs();
}

export async function updateSongUrl(songId: string, url: string): Promise<Song> {
  const { data, error } = await getSupabaseClient()
    .from('songs')
    .update({ ultimate_guitar_url: url })
    .eq('id', songId)
    .select()
    .single();
  if (error) throw error;
  return withComputedTags(mapSongRow(data));
}

export async function updateChordChart(songId: string, chordChart: string): Promise<Song> {
  const { data, error } = await getSupabaseClient()
    .from('songs')
    .update({ chord_chart: chordChart.trim() || null })
    .eq('id', songId)
    .select()
    .single();
  if (error) throw error;
  return withComputedTags(mapSongRow(data));
}

async function fetchRecordings(
  client: ReturnType<typeof getSupabaseClient>,
  songId: string,
): Promise<SongRecording[]> {
  const { data, error } = await client.from('songs').select('recordings').eq('id', songId).single();
  if (error) throw error;
  return (data.recordings ?? []) as SongRecording[];
}

// No cap, and no reordering — recordings just stay in the order they were
// added. Each gets its own object at {songId}/{recordingId} in the shared
// "audio" bucket, so adding or removing one never touches another.
export async function addSongRecording(songId: string, title: string, file: File): Promise<Song> {
  const client = getSupabaseClient();
  const recordingId = crypto.randomUUID();
  const path = `${songId}/${recordingId}`;

  const { error: uploadError } = await client.storage
    .from('audio')
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (uploadError) throw uploadError;

  const existing = await fetchRecordings(client, songId);
  const next: SongRecording[] = [...existing, { id: recordingId, title: title.trim(), path }];
  const { data, error } = await client.from('songs').update({ recordings: next }).eq('id', songId).select().single();
  if (error) throw error;
  return withComputedTags(mapSongRow(data));
}

export async function renameSongRecording(songId: string, recordingId: string, title: string): Promise<Song> {
  const client = getSupabaseClient();
  const existing = await fetchRecordings(client, songId);
  const next = existing.map((r) => (r.id === recordingId ? { ...r, title: title.trim() } : r));
  const { data, error } = await client.from('songs').update({ recordings: next }).eq('id', songId).select().single();
  if (error) throw error;
  return withComputedTags(mapSongRow(data));
}

export async function removeSongRecording(songId: string, recordingId: string): Promise<Song> {
  const client = getSupabaseClient();
  const existing = await fetchRecordings(client, songId);
  const target = existing.find((r) => r.id === recordingId);
  if (target) {
    const { error: removeError } = await client.storage.from('audio').remove([target.path]);
    if (removeError) throw removeError;
  }
  const next = existing.filter((r) => r.id !== recordingId);
  const { data, error } = await client.from('songs').update({ recordings: next }).eq('id', songId).select().single();
  if (error) throw error;
  return withComputedTags(mapSongRow(data));
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

export async function deleteSong(songId: string): Promise<Song[]> {
  const { error } = await getSupabaseClient().from('songs').delete().eq('id', songId);
  if (error) throw error;
  return getSongs();
}

// --- Settings: category management ---

export async function addCategory(name: string): Promise<Category[]> {
  const client = getSupabaseClient();
  const { data: existing, error: fetchError } = await client
    .from('categories')
    .select('id, sort_order')
    .eq('space', currentSpace);
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
  const { error: insertError } = await client.from('categories').insert({
    id,
    name: name.trim(),
    type: 'single',
    computed: false,
    guided_picker_enabled: true,
    sort_order: nextSortOrder,
    space: currentSpace,
  });
  if (insertError) throw insertError;
  return getCategories();
}

export async function renameCategory(categoryId: string, name: string): Promise<Category[]> {
  const { error } = await getSupabaseClient()
    .from('categories')
    .update({ name: name.trim() })
    .eq('id', categoryId)
    .eq('space', currentSpace);
  if (error) throw error;
  return getCategories();
}

// Retiring drops the category from the active list — Guided Picker, Filters,
// Sort, and the tag editor all stop offering it. Songs keep whatever value
// they already had under that key; nothing touches song data, matching the
// JSONB "a key nobody reads is just inert" model.
export async function retireCategory(categoryId: string): Promise<Category[]> {
  const { error } = await getSupabaseClient()
    .from('categories')
    .delete()
    .eq('id', categoryId)
    .eq('space', currentSpace);
  if (error) throw error;
  return getCategories();
}

export async function reorderCategories(orderedIds: string[]): Promise<Category[]> {
  const client = getSupabaseClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      client.from('categories').update({ sort_order: index }).eq('id', id).eq('space', currentSpace),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return getCategories();
}

export async function setCategoryGuidedPickerEnabled(categoryId: string, enabled: boolean): Promise<Category[]> {
  const { error } = await getSupabaseClient()
    .from('categories')
    .update({ guided_picker_enabled: enabled })
    .eq('id', categoryId)
    .eq('space', currentSpace);
  if (error) throw error;
  return getCategories();
}

export async function setCategoryScatterPickerEnabled(categoryId: string, enabled: boolean): Promise<Category[]> {
  const { error } = await getSupabaseClient()
    .from('categories')
    .update({ scatter_picker_enabled: enabled })
    .eq('id', categoryId)
    .eq('space', currentSpace);
  if (error) throw error;
  return getCategories();
}

// Registers a value on the category itself (Settings' "Values" screen has no
// song to attach a brand-new value to) — merged with whatever songs already
// carry wherever categoryValues() is read, so a pre-registered value is
// immediately selectable everywhere without requiring a song to be tagged
// with it first.
export async function addCategoryValue(categoryId: string, value: string): Promise<Category[]> {
  const client = getSupabaseClient();
  const trimmed = value.trim();
  const { data: existing, error: fetchError } = await client
    .from('categories')
    .select('values')
    .eq('id', categoryId)
    .eq('space', currentSpace)
    .single();
  if (fetchError) throw fetchError;

  const nextValues = Array.from(new Set([...(existing.values ?? []), trimmed]));
  const { error } = await client
    .from('categories')
    .update({ values: nextValues })
    .eq('id', categoryId)
    .eq('space', currentSpace);
  if (error) throw error;
  return getCategories();
}

// Overwrites the registered value list's order outright (unlike
// addCategoryValue/updateRegisteredValues, which only ever append or filter)
// — categoryValues() treats this array's order as the display order
// everywhere, so this is the one write path a plain reorder needs.
export async function reorderCategoryValues(categoryId: string, orderedValues: string[]): Promise<Category[]> {
  const { error } = await getSupabaseClient()
    .from('categories')
    .update({ values: orderedValues })
    .eq('id', categoryId)
    .eq('space', currentSpace);
  if (error) throw error;
  return getCategories();
}

async function updateRegisteredValues(
  client: ReturnType<typeof getSupabaseClient>,
  categoryId: string,
  transform: (values: string[]) => string[],
) {
  const { data: existing, error: fetchError } = await client
    .from('categories')
    .select('values')
    .eq('id', categoryId)
    .eq('space', currentSpace)
    .single();
  if (fetchError) throw fetchError;
  const { error } = await client
    .from('categories')
    .update({ values: transform(existing.values ?? []) })
    .eq('id', categoryId)
    .eq('space', currentSpace);
  if (error) throw error;
}

export async function renameCategoryValue(
  categoryId: string,
  oldValue: string,
  newValue: string,
): Promise<{ songs: Song[]; categories: Category[] }> {
  const client = getSupabaseClient();
  // Category ids are only unique per space now, so this cascade must stay
  // scoped to the current space too — otherwise a same-named category in
  // the other space (e.g. both defining their own "genre") could get its
  // songs' tags rewritten by a rename that has nothing to do with it.
  const { data, error } = await client.from('songs').select('id, tags').eq('space', currentSpace);
  if (error) throw error;

  const writes = data.flatMap((row: { id: string; tags: Record<string, TagValue> }) => {
    const v = row.tags?.[categoryId];
    if (v !== oldValue) return [];
    return [client.rpc('update_song_tag', { p_song_id: row.id, p_category_id: categoryId, p_value: newValue })];
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
  const { data, error } = await client.from('songs').select('id, tags').eq('space', currentSpace);
  if (error) throw error;

  const writes = data.flatMap((row: { id: string; tags: Record<string, TagValue> }) => {
    const v = row.tags?.[categoryId];
    if (v !== value) return [];
    return [client.rpc('delete_song_tag', { p_song_id: row.id, p_category_id: categoryId })];
  });

  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;

  await updateRegisteredValues(client, categoryId, (values) => values.filter((v) => v !== value));

  const [songs, categories] = await Promise.all([getSongs(), getCategories()]);
  return { songs, categories };
}

// --- Settings: rating scale management ---

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
    const { error: cascadeError } = await client
      .from('songs')
      .update({ last_rating_label: trimmedLabel })
      .eq('last_rating_label', oldLabel);
    if (cascadeError) throw cascadeError;
  }

  const [ratingScale, songs] = await Promise.all([getRatingScale(), getSongs()]);
  return { ratingScale, songs };
}

export async function removeRatingEntry(label: string): Promise<RatingScaleEntry[]> {
  const { error } = await getSupabaseClient().from('rating_scale').delete().eq('label', label);
  if (error) throw error;
  return getRatingScale();
}

// --- Playlists ---
// Saved, named, reordered song lists — an extension of the ephemeral queue
// (which stays local-only). Scoped to whichever space is active, same as
// songs/categories. playlist_songs is the join table holding order and
// leader (see the migration for why those can't live on the song itself).

export async function getPlaylists(): Promise<PlaylistSummary[]> {
  const client = getSupabaseClient();
  const { data: playlists, error } = await client
    .from('playlists')
    .select('id, name, created_at')
    .eq('space', currentSpace)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (playlists.length === 0) return [];

  const { data: songRows, error: songsError } = await client
    .from('playlist_songs')
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

  return playlists.map((p: { id: string; name: string; created_at: string }) => ({
    id: p.id,
    name: p.name,
    songCount: counts.get(p.id) ?? 0,
    createdAt: p.created_at,
  }));
}

export async function getPlaylistDetail(playlistId: string): Promise<PlaylistDetail> {
  const client = getSupabaseClient();
  const [playlistResult, songsResult] = await Promise.all([
    client.from('playlists').select('id, name').eq('id', playlistId).single(),
    client
      .from('playlist_songs')
      .select('song_id, leader, songs(title, artist)')
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
    songs: rows.map((row) => ({
      songId: row.song_id,
      title: row.songs.title,
      artist: row.songs.artist,
      leader: row.leader,
    })),
  };
}

export async function createPlaylistFromQueue(name: string, entries: QueueEntry[]): Promise<string> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('playlists')
    .insert({ name: name.trim(), space: currentSpace })
    .select()
    .single();
  if (error) throw error;

  if (entries.length > 0) {
    const { error: songsError } = await client.from('playlist_songs').insert(
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
  const { error: deleteError } = await client.from('playlist_songs').delete().eq('playlist_id', playlistId);
  if (deleteError) throw deleteError;

  if (entries.length === 0) return;
  const { error: insertError } = await client.from('playlist_songs').insert(
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
  const { error } = await getSupabaseClient().from('playlists').update({ name: name.trim() }).eq('id', playlistId);
  if (error) throw error;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  // playlist_songs rows cascade-delete via the foreign key.
  const { error } = await getSupabaseClient().from('playlists').delete().eq('id', playlistId);
  if (error) throw error;
}

// Appends at the end; a no-op if the song is already in the playlist
// (silently, rather than erroring on the composite-key conflict) so the
// Results-row picker and the tag editor's own search can both call this
// without worrying about duplicates.
export async function addSongToPlaylist(playlistId: string, songId: string): Promise<void> {
  const client = getSupabaseClient();
  const { data: existing, error: fetchError } = await client
    .from('playlist_songs')
    .select('song_id, sort_order')
    .eq('playlist_id', playlistId);
  if (fetchError) throw fetchError;
  if (existing.some((row: { song_id: string }) => row.song_id === songId)) return;

  const nextSortOrder =
    existing.length > 0 ? Math.max(...existing.map((row: { sort_order: number }) => row.sort_order)) + 1 : 0;
  const { error } = await client
    .from('playlist_songs')
    .insert({ playlist_id: playlistId, song_id: songId, sort_order: nextSortOrder, leader: null });
  if (error) throw error;
}

export async function removeSongFromPlaylist(playlistId: string, songId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('playlist_songs')
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
    .from('playlist_songs')
    .update({ leader })
    .eq('playlist_id', playlistId)
    .eq('song_id', songId);
  if (error) throw error;
}

export async function reorderPlaylistSongs(playlistId: string, orderedSongIds: string[]): Promise<void> {
  const client = getSupabaseClient();
  const results = await Promise.all(
    orderedSongIds.map((songId, index) =>
      client.from('playlist_songs').update({ sort_order: index }).eq('playlist_id', playlistId).eq('song_id', songId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// --- Playlist leaders (shared across both spaces) ---

export async function getPlaylistLeaders(): Promise<string[]> {
  const { data, error } = await getSupabaseClient().from('playlist_leaders').select('name').order('sort_order');
  if (error) throw error;
  return data.map((row: { name: string }) => row.name);
}

export async function addPlaylistLeader(name: string): Promise<string[]> {
  const client = getSupabaseClient();
  const { data: existing, error: fetchError } = await client.from('playlist_leaders').select('sort_order');
  if (fetchError) throw fetchError;
  const nextSortOrder =
    existing.length > 0 ? Math.max(...existing.map((row: { sort_order: number }) => row.sort_order)) + 1 : 0;
  const { error } = await client.from('playlist_leaders').insert({ name: name.trim(), sort_order: nextSortOrder });
  if (error) throw error;
  return getPlaylistLeaders();
}

export async function renamePlaylistLeader(oldName: string, newName: string): Promise<string[]> {
  const client = getSupabaseClient();
  const trimmed = newName.trim();
  const { error } = await client.from('playlist_leaders').update({ name: trimmed }).eq('name', oldName);
  if (error) throw error;

  const { error: cascadeError } = await client
    .from('playlist_songs')
    .update({ leader: trimmed })
    .eq('leader', oldName);
  if (cascadeError) throw cascadeError;

  return getPlaylistLeaders();
}

export async function removePlaylistLeader(name: string): Promise<string[]> {
  const client = getSupabaseClient();
  const { error } = await client.from('playlist_leaders').delete().eq('name', name);
  if (error) throw error;

  const { error: cascadeError } = await client
    .from('playlist_songs')
    .update({ leader: null })
    .eq('leader', name);
  if (cascadeError) throw cascadeError;

  return getPlaylistLeaders();
}

export async function reorderPlaylistLeaders(orderedNames: string[]): Promise<string[]> {
  const client = getSupabaseClient();
  const results = await Promise.all(
    orderedNames.map((name, index) => client.from('playlist_leaders').update({ sort_order: index }).eq('name', name)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return getPlaylistLeaders();
}
