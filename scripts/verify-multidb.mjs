// Compares the new multi-database tables against the legacy tables, record
// by record. Read-only. Usage (from scripts/):  node verify-multidb.mjs [--run]
// With --run it first re-runs migrate_legacy_to_multidb() (safe to repeat).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const env = readFileSync(new URL('./.env', import.meta.url), 'utf8');
const url = env.match(/SUPABASE_URL=(.+)/)[1].trim();
const key = env.match(/SERVICE_ROLE_KEY=(.+)/)[1].trim();
const admin = createClient(url, key);

async function all(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

if (process.argv.includes('--run')) {
  const { data, error } = await admin.rpc('migrate_legacy_to_multidb');
  if (error) throw new Error(`migrate: ${error.message}`);
  console.log('transform result:', JSON.stringify(data));
}

const [songs, categories, playlists, playlistSongs, leaders] = await Promise.all(
  ['songs', 'categories', 'playlists', 'playlist_songs', 'playlist_leaders'].map(all),
);
const [dbs, shared, entries, dbCats, dbPlaylists, dbPlaylistSongs, dbLeaders, globals] = await Promise.all(
  ['app_databases', 'shared_songs', 'db_songs', 'db_categories', 'db_playlists', 'db_playlist_songs', 'db_playlist_leaders', 'global_settings'].map(all),
);

const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blank = (v) => (v == null || v === '' ? null : v);

const dbByName = Object.fromEntries(dbs.map((d) => [d.name, d]));
check(dbByName['Pop Songs'] && dbByName['Circle Songs'], 'both legacy databases exist');
const spaceToDb = { pop_songs: dbByName['Pop Songs']?.id, circle_songs: dbByName['Circle Songs']?.id };
const sharedById = new Map(shared.map((s) => [s.id, s]));
const entryById = new Map(entries.map((e) => [e.id, e]));

// ── songs ──
check(entries.length === songs.length, `entries ${entries.length} vs legacy songs ${songs.length}`);
let enriched = 0, lyricsOverrides = 0, genreOverrides = 0, merged = 0, gainedLyrics = 0;
for (const song of songs) {
  const entry = entryById.get(song.id);
  if (!entry) { problems.push(`missing entry for ${song.title}`); continue; }
  const label = `${song.title} (${song.space})`;
  const sharedSong = sharedById.get(entry.shared_song_id);
  check(!!sharedSong, `${label}: shared song missing`);
  if (!sharedSong) continue;

  check(entry.db_id === spaceToDb[song.space], `${label}: wrong database`);
  check(sharedSong.title === song.title || sharedSong.owner_db !== entry.db_id, `${label}: title changed`);
  check(sharedSong.artist === song.artist || sharedSong.owner_db !== entry.db_id, `${label}: artist changed`);

  const url = sharedSong.ultimate_guitar_url;
  if (song.ultimate_guitar_url) check(url === song.ultimate_guitar_url || sharedSong.owner_db !== entry.db_id, `${label}: link changed`);
  else if (url) enriched++;

  const lyrics = entry.lyrics_unlinked ? entry.chord_chart_override : sharedSong.chord_chart;
  // A non-owner entry with no lyrics of its own legitimately gains the shared ones.
  const gainsSharedLyrics = blank(song.chord_chart) === null && sharedSong.owner_db !== entry.db_id;
  check(blank(lyrics) === blank(song.chord_chart) || gainsSharedLyrics, `${label}: effective lyrics differ`);
  if (gainsSharedLyrics && blank(lyrics)) gainedLyrics++;
  if (entry.lyrics_unlinked) lyricsOverrides++;

  const legacyGenre = blank(song.tags?.genre_2);
  const genre = entry.genre_unlinked ? entry.genre_override : sharedSong.genre;
  check(blank(genre) === legacyGenre || (legacyGenre === null && sharedSong.owner_db !== entry.db_id), `${label}: effective genre differs (${genre} vs ${legacyGenre})`);
  if (entry.genre_unlinked) genreOverrides++;

  const { genre_2, ...legacyTags } = song.tags ?? {};
  check(eq(entry.tags, legacyTags), `${label}: tags differ`);
  check(entry.memorized === song.memorized, `${label}: memorized differs`);
  check(entry.play_count === song.play_count, `${label}: play_count differs`);
  check(entry.last_rating_label === song.last_rating_label, `${label}: rating differs`);
  check(String(entry.last_played_at && new Date(entry.last_played_at).getTime()) === String(song.last_played_at && new Date(song.last_played_at).getTime()), `${label}: last_played_at differs`);
  check(eq(entry.recordings, song.recordings), `${label}: recordings differ`);
  check(eq(entry.not_applicable_categories, song.not_applicable_categories), `${label}: not-applicable differs`);
}
for (const group of Map.groupBy(entries, (e) => e.shared_song_id).values()) if (group.length > 1) merged++;

// every shared song is used, and owned by a database that actually has an entry for it
for (const s of shared) {
  const users = entries.filter((e) => e.shared_song_id === s.id);
  check(users.length > 0, `shared song ${s.title} has no entries`);
  check(users.some((e) => e.db_id === s.owner_db), `shared song ${s.title}: owner has no entry`);
}

// ── categories / playlists / leaders / globals ──
const legacyCatCount = categories.length;
check(dbCats.length >= legacyCatCount, 'categories not all copied');
for (const c of categories) {
  const m = dbCats.find((d) => d.db_id === spaceToDb[c.space] && d.id === c.id);
  check(!!m, `category ${c.id}/${c.space} missing`);
  if (m && c.id !== 'genre_2') check(eq(m.values, c.values) && m.name === c.name && m.sort_order === c.sort_order, `category ${c.id}/${c.space} differs`);
}
for (const d of [dbByName['Pop Songs'], dbByName['Circle Songs']]) check(dbCats.some((c) => c.db_id === d.id && c.id === 'genre_2'), `genre category missing in ${d.name}`);

check(dbPlaylists.length === playlists.length, 'playlist count');
check(dbPlaylistSongs.length === playlistSongs.length, 'playlist song count');
for (const ps of dbPlaylistSongs) check(entryById.has(ps.song_id), 'playlist song points nowhere');
check(dbLeaders.length === leaders.length * 2, 'leader count');

const genreValues = globals.find((g) => g.key === 'genre_values')?.value ?? [];
const observed = new Set(songs.map((s) => s.tags?.genre_2).filter(Boolean));
check([...observed].every((g) => genreValues.includes(g)), 'a genre in use is missing from the global list');

// The public API must not be able to read the new tables yet (no policies).
const appKey = (await admin.from('app_config').select('passphrase').single()).data.passphrase;
const anon = createClient(url, env.match(/ANON_KEY=(.+)/)?.[1]?.trim() ?? readFileSync(new URL('../app/.env.local', import.meta.url), 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim(),
  { global: { headers: { 'x-app-key': appKey } } });
for (const table of ['app_databases', 'shared_songs', 'db_songs', 'db_categories', 'db_playlists', 'global_settings']) {
  const { data, error } = await anon.from(table).select('*').limit(1);
  check(error !== null || data.length === 0, `anon can read ${table}`);
}

console.log(JSON.stringify({
  legacySongs: songs.length, entries: entries.length, sharedSongs: shared.length, mergedAcrossDatabases: merged,
  linkEnriched: enriched, gainedSharedLyrics: gainedLyrics, unlinkedLyrics: lyricsOverrides, unlinkedGenre: genreOverrides,
  categories: dbCats.length, playlists: dbPlaylists.length, playlistSongs: dbPlaylistSongs.length,
  leaders: dbLeaders.length, genreValues: genreValues.length,
}, null, 1));
if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S):`);
  problems.slice(0, 40).forEach((p) => console.log(' -', p));
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
