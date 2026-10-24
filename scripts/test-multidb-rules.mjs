// Exercises the multi-database access rules and functions through the same
// public API the app uses (anon key + headers), using throwaway "ZZ" databases
// that are deleted at the end. Never edits Pop Songs or Circle Songs rows.
// Usage (from scripts/):  node test-multidb-rules.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('./.env', import.meta.url), 'utf8');
const url = env.match(/SUPABASE_URL=(.+)/)[1].trim();
const serviceKey = env.match(/SERVICE_ROLE_KEY=(.+)/)[1].trim();
const anonKey = readFileSync(new URL('../app/.env.local', import.meta.url), 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim();
const admin = createClient(url, serviceKey);
const config = (await admin.from('app_config').select('*').single()).data;

const as = (appKey, db) =>
  createClient(url, anonKey, {
    global: { headers: { 'x-app-key': appKey, ...(db ? { 'x-db-id': db.id, 'x-db-key': db.password } : {}) } },
  });

let failures = 0;
let checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { failures++; console.log('  FAIL:', label); }
}
const errorOf = async (promise) => (await promise).error;
const detail = (error) => (error?.details ? JSON.parse(error.details) : null);

const { data: legacyDbs } = await admin.from('app_databases').select('id,name');
const pop = { id: legacyDbs.find((d) => d.name === 'Pop Songs').id, password: config.passphrase };
const circle = { id: legacyDbs.find((d) => d.name === 'Circle Songs').id, password: config.passphrase };

const createdDbs = [];
try {
  // ── reading ──
  console.log('reading & isolation');
  const noDb = as(config.passphrase);
  ok((await noDb.from('db_songs').select('id').limit(1)).data.length === 0, 'no database unlocked sees no entries');
  ok((await noDb.from('shared_songs').select('id', { count: 'exact', head: true })).count > 600, 'shared library is readable without a database');
  ok((await noDb.from('app_databases').select('id,name')).data.length >= 2, 'database names are listable');
  ok(!!(await errorOf(noDb.from('app_databases').select('password_hash'))), 'password hash is not selectable');
  ok(!!(await errorOf(noDb.from('app_databases').select('*'))), 'select * on databases is refused (hash column)');

  const popClient = as(config.passphrase, pop);
  const popCount = (await popClient.from('db_songs').select('id', { count: 'exact', head: true })).count;
  ok(popCount >= 600, `Pop sees its own songs (${popCount})`);
  ok((await popClient.from('db_songs').select('id').eq('db_id', circle.id).limit(1)).data.length === 0, 'Pop cannot read Circle entries');
  ok((await popClient.from('db_categories').select('id').eq('db_id', circle.id)).data.length === 0, 'Pop cannot read Circle categories');
  ok((await popClient.from('db_playlists').select('id').eq('db_id', circle.id)).data.length === 0, 'Pop cannot read Circle playlists');
  ok((await as(config.passphrase, { ...pop, password: 'wrong' }).from('db_songs').select('id').limit(1)).data.length === 0, 'wrong database password sees nothing');
  ok((await as(config.passphrase, { id: circle.id, password: 'wrong' }).from('db_songs').select('id').limit(1)).data.length === 0, 'wrong password for Circle sees nothing');
  ok((await noDb.rpc('unlock_database', { p_db: pop.id, p_password: config.passphrase })).data === true, 'unlock_database accepts the right password');
  ok((await noDb.rpc('unlock_database', { p_db: pop.id, p_password: 'nope' })).data === false, 'unlock_database rejects a wrong one');
  ok((await as('not-the-app-key').rpc('unlock_database', { p_db: pop.id, p_password: config.passphrase })).data !== true, 'unlock needs the app password too');

  // viewer: read-only everywhere
  const viewer = as(config.viewer_passphrase, pop);
  ok((await viewer.from('db_songs').select('id').limit(1)).data.length === 1, 'viewer can read inside an unlocked database');
  ok(!!(await errorOf(viewer.from('db_categories').insert({ id: 'zz_viewer', db_id: pop.id, name: 'x', type: 'single', sort_order: 99 }))), 'viewer cannot write');
  ok(!!(await errorOf(viewer.rpc('create_database', { p_name: 'ZZ Viewer', p_password: 'x' }))), 'viewer cannot create a database');
  ok(!!(await errorOf(viewer.rpc('rename_genre_value', { p_old: 'ZZ', p_new: 'ZZ2' }))), 'viewer cannot edit global genre values');

  // ── lifecycle in throwaway databases ──
  console.log('databases, adding songs, duplicates');
  const adminNoDb = as(config.passphrase);
  const mk = async (name) => {
    const { data, error } = await adminNoDb.rpc('create_database', { p_name: name, p_password: 'pw-' + name });
    if (error) throw new Error(`create_database ${name}: ${error.message}`);
    const db = { id: data, password: 'pw-' + name };
    createdDbs.push(db.id);
    return db;
  };
  const dbA = await mk('ZZ Rules Test A');
  const dbB = await mk('ZZ Rules Test B');
  ok((await errorOf(adminNoDb.rpc('create_database', { p_name: 'zz rules test a', p_password: 'x' })))?.message === 'NAME_TAKEN', 'database names are unique (any case)');
  const A = as(config.passphrase, dbA);
  const B = as(config.passphrase, dbB);
  ok((await A.from('db_categories').select('id').order('sort_order')).data.map((c) => c.id).join() === 'memorized,performance_confidence,memorization_confidence,genre_2', 'new database starts with only the permanent categories');

  const create = (client, title, artist, extra = {}) =>
    client.rpc('create_song', { p_title: title, p_artist: artist, p_url: '', p_lyrics: '', p_tags: {}, p_confirmed: false, ...extra });

  const first = await create(A, 'ZZ Brand New Song', 'ZZ Artist', { p_lyrics: 'ZZ lyrics', p_tags: { genre_2: 'ZZ Genre', mood: 'Calm' } });
  ok(!first.error, `create_song works (${first.error?.message})`);
  const firstEntry = first.data;
  ok(firstEntry?.shared_songs?.owner_db === dbA.id && firstEntry.shared_songs.genre === 'ZZ Genre' && firstEntry.tags.mood === 'Calm' && !('genre_2' in firstEntry.tags), 'new song is owned by its database, genre goes to the shared song');

  let dup = await create(A, 'zz brand new song!', 'ZZ ARTIST');
  ok(dup.error?.message === 'DUPLICATE_EXACT' && detail(dup.error)[0].in_database === true, 'exact duplicate (case/punctuation) is blocked, in this database');
  dup = await create(B, 'The ZZ Brand New Song', 'zz artist');
  ok(dup.error?.message === 'DUPLICATE_EXACT' && detail(dup.error)[0].in_database === false, 'exact duplicate from another database is blocked and says so');
  dup = await create(B, 'ZZ Totally Different', 'Someone', { p_url: 'https://tabs.ultimate-guitar.com/tab/x/y-chords-9999' });
  ok(!dup.error, 'a song with a fresh link is fine');
  dup = await create(B, 'ZZ Other Name', 'Other', { p_url: 'http://www.ultimate-guitar.com/tab/different/spelling-chords-9999/' });
  ok(dup.error?.message === 'DUPLICATE_EXACT', 'same Ultimate Guitar tab id with a different URL spelling is blocked');
  dup = await create(A, 'ZZ Brand New Song (Live)', 'ZZ Artist');
  ok(dup.error?.message === 'DUPLICATE_SIMILAR', 'a parenthetical variant needs confirmation');
  dup = await create(A, 'ZZ Brand New Song (Live)', 'ZZ Artist', { p_confirmed: true });
  ok(!dup.error, 'confirming lets a genuinely different song through');
  dup = await create(A, 'ZZ Artist', 'ZZ Brand New Song');
  ok(dup.error?.message === 'DUPLICATE_SIMILAR' && /swapped/i.test(detail(dup.error)[0].reason), 'swapped title and artist is caught');
  dup = await create(A, 'ZZ Brand New Sung', 'ZZ Artist');
  ok(dup.error?.message === 'DUPLICATE_SIMILAR', 'a typo in the title is caught');

  // against real library data (read-only, nothing is created)
  const probe = async (title, artist) => (await A.rpc('find_song_matches', { p_title: title, p_artist: artist, p_url: '' })).data ?? [];
  let m = await probe('Night Mantra', 'Renee & Jeremy');
  ok(m[0]?.tier === 'exact', '"&" vs "and" matches an existing song exactly');
  m = await probe('Riomas Test Song', 'Riomas Amini');
  m = await probe('Jolene', 'Ray LaMontagne');
  ok(m.some((x) => x.tier === 'similar' && /Same title/.test(x.reason)), 'same title by a different artist asks for confirmation');
  m = await probe('You Are Safe Now', 'Ríomas Amini');
  ok(m[0]?.tier === 'exact', 'accents are ignored when matching');

  // ── importing and per-database independence ──
  console.log('importing, unlinking, ownership');
  const { data: today } = await admin.from('shared_songs').select('id,title,owner_db,genre,chord_chart').eq('title', 'Today').single();
  const imp = await A.from('db_songs').insert({ db_id: dbA.id, shared_song_id: today.id }).select('*, shared_songs(*)').single();
  ok(!imp.error && Object.keys(imp.data.tags).length === 0 && imp.data.play_count === 0 && imp.data.memorized === false, 'imported song arrives bare: no tags, no stats');
  ok(!!(await errorOf(A.from('db_songs').insert({ db_id: dbA.id, shared_song_id: today.id }))), 'cannot import the same song twice');
  ok(!!(await errorOf(A.from('db_songs').insert({ db_id: pop.id, shared_song_id: today.id }))), 'cannot write into a database you have not unlocked');
  const importedId = imp.data.id;

  const edit = await A.from('shared_songs').update({ title: 'Today (hacked)' }).eq('id', today.id).select();
  ok(!edit.error && edit.data.length === 0, 'a non-owner cannot edit a shared song');
  const ownEdit = await A.from('shared_songs').update({ artist: 'ZZ Artist Renamed' }).eq('id', firstEntry.shared_song_id).select();
  ok(ownEdit.data?.length === 1, 'the owner can edit its shared song');
  ok((await B.from('shared_songs').update({ artist: 'ZZ Hacked' }).eq('id', firstEntry.shared_song_id).select()).data.length === 0, 'another database cannot edit it');
  await A.from('shared_songs').update({ artist: 'ZZ Artist' }).eq('id', firstEntry.shared_song_id);

  let g = await A.rpc('update_db_song_tag', { p_song_id: importedId, p_category_id: 'genre_2', p_value: 'ZZ Local Genre' });
  ok(g.data?.genre_unlinked === true && g.data.genre_override === 'ZZ Local Genre' && g.data.shared_songs.genre === today.genre, 'non-owner genre edit stays local and leaves the shared genre alone');
  g = await A.rpc('relink_db_song_field', { p_song_id: importedId, p_field: 'genre' });
  ok(g.data?.genre_unlinked === false && g.data.genre_override === null, 'relinking genre drops the local value');
  g = await A.rpc('update_db_song_tag', { p_song_id: firstEntry.id, p_category_id: 'genre_2', p_value: 'ZZ New Genre' });
  ok(g.data?.shared_songs.genre === 'ZZ New Genre' && g.data.genre_unlinked === false, 'owner genre edit changes the shared genre');
  g = await A.rpc('delete_db_song_tag', { p_song_id: firstEntry.id, p_category_id: 'genre_2' });
  ok(g.data?.shared_songs.genre === null, 'owner can clear the genre');

  let l = await A.rpc('set_db_song_lyrics', { p_song_id: importedId, p_text: 'my version' });
  ok(l.error?.message === 'LYRICS_LINKED', 'lyrics of someone else\'s song are read-only until unlinked');
  l = await A.rpc('unlink_db_song_field', { p_song_id: importedId, p_field: 'lyrics' });
  ok(l.data?.lyrics_unlinked === true, 'unlink lyrics');
  l = await A.rpc('set_db_song_lyrics', { p_song_id: importedId, p_text: 'my version' });
  ok(l.data?.chord_chart_override === 'my version' && l.data.shared_songs.chord_chart === today.chord_chart, 'unlinked edit is local only');
  l = await A.rpc('relink_db_song_field', { p_song_id: importedId, p_field: 'lyrics' });
  ok(l.data?.lyrics_unlinked === false && l.data.chord_chart_override === null, 'relink lyrics');
  l = await A.rpc('set_db_song_lyrics', { p_song_id: firstEntry.id, p_text: 'owner lyrics v2' });
  ok(l.data?.shared_songs.chord_chart === 'owner lyrics v2', 'owner lyric edit changes the shared lyrics');
  ok(!!(await errorOf(A.rpc('unlink_db_song_field', { p_song_id: firstEntry.id, p_field: 'lyrics' }))), 'the owner has nothing to unlink');

  const rated = await A.rpc('rate_db_song', { p_song_id: firstEntry.id, p_rating_label: 'Good' });
  ok(rated.data?.play_count === 1 && rated.data.last_rating_label === 'Good', 'rating works through the function');
  ok((await B.rpc('rate_db_song', { p_song_id: firstEntry.id, p_rating_label: 'Great' })).error !== null, 'another database cannot rate it');

  // B imports A's song: independent state, shared lyrics follow the owner
  const impB = await B.from('db_songs').insert({ db_id: dbB.id, shared_song_id: firstEntry.shared_song_id }).select('*, shared_songs(*)').single();
  ok(!impB.error && impB.data.play_count === 0 && impB.data.last_rating_label === null && impB.data.shared_songs.chord_chart === 'owner lyrics v2', 'B gets A\'s song without A\'s rating, with A\'s lyrics');

  // removing the owner's entry hands the song to B; removing B's last entry deletes it
  let r = await A.rpc('remove_db_song', { p_song_id: firstEntry.id });
  ok(!r.error, `owner can remove its entry (${r.error?.message})`);
  const afterTransfer = (await admin.from('shared_songs').select('owner_db').eq('id', firstEntry.shared_song_id).single()).data;
  ok(afterTransfer?.owner_db === dbB.id, 'ownership passes to the remaining database');
  ok((await B.from('shared_songs').update({ artist: 'ZZ Now B' }).eq('id', firstEntry.shared_song_id).select()).data.length === 1, 'the new owner can edit it');
  r = await B.rpc('remove_db_song', { p_song_id: impB.data.id });
  ok(!r.error && (await admin.from('shared_songs').select('id').eq('id', firstEntry.shared_song_id)).data.length === 0, 'removing the last entry deletes the shared song');
  r = await A.rpc('remove_db_song', { p_song_id: importedId });
  ok(!r.error && (await admin.from('shared_songs').select('id').eq('id', today.id)).data.length === 1, 'removing an imported song leaves the shared song in place');
  ok(!!(await errorOf(A.rpc('remove_db_song', { p_song_id: (await admin.from('db_songs').select('id').eq('db_id', pop.id).limit(1)).data[0].id }))), 'cannot remove another database\'s song');

  // global functions run for admin, no-op harmlessly on values nobody uses
  ok(!(await errorOf(adminNoDb.rpc('rename_genre_value', { p_old: 'ZZ Nothing', p_new: 'ZZ Nothing 2' }))), 'admin can run a global genre rename');
  ok(!(await errorOf(adminNoDb.rpc('rename_rating_label', { p_old: 'ZZ Nothing', p_new: 'ZZ Nothing 2' }))), 'admin can run a global rating rename');
} finally {
  // cleanup: shared songs owned by test databases, then the databases themselves
  for (const id of createdDbs) {
    const { data: owned } = await admin.from('shared_songs').select('id').eq('owner_db', id);
    for (const s of owned ?? []) {
      await admin.from('db_songs').delete().eq('shared_song_id', s.id);
      await admin.from('shared_songs').delete().eq('id', s.id);
    }
    await admin.from('db_songs').delete().eq('db_id', id);
    await admin.from('app_databases').delete().eq('id', id);
  }
  const leftovers = (await admin.from('shared_songs').select('id').ilike('title', 'ZZ %')).data?.length ?? 0;
  const dbsLeft = (await admin.from('app_databases').select('id').ilike('name', 'ZZ %')).data?.length ?? 0;
  console.log(`cleanup: ${leftovers} test songs and ${dbsLeft} test databases left (should be 0 and 0)`);
}
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
