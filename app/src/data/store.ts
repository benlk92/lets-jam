import type { Category, RatingScaleEntry, Song, Space, TagValue } from '../types';
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
    audioPath: row.audio_path ?? null,
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

// One recording per song — a fixed path plus upsert means a re-upload just
// overwrites the previous file rather than accumulating orphaned objects.
export async function uploadSongAudio(songId: string, file: File): Promise<Song> {
  const client = getSupabaseClient();
  const { error: uploadError } = await client.storage
    .from('audio')
    .upload(songId, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
  if (uploadError) throw uploadError;

  const { data, error } = await client.from('songs').update({ audio_path: songId }).eq('id', songId).select().single();
  if (error) throw error;
  return withComputedTags(mapSongRow(data));
}

export async function removeSongAudio(songId: string): Promise<Song> {
  const client = getSupabaseClient();
  const { error: removeError } = await client.storage.from('audio').remove([songId]);
  if (removeError) throw removeError;

  const { data, error } = await client
    .from('songs')
    .update({ audio_path: null })
    .eq('id', songId)
    .select()
    .single();
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
