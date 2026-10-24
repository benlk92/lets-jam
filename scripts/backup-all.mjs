// Full local backup: every table as JSON, plus every file in the audio
// bucket. Read-only. Usage (from scripts/):  node backup-all.mjs [label]
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = readFileSync(new URL('./.env', import.meta.url), 'utf8');
const url = env.match(/SUPABASE_URL=(.+)/)?.[1].trim();
const key = env.match(/SERVICE_ROLE_KEY=(.+)/)?.[1].trim();
const admin = createClient(url, key);

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const dir = join(new URL('./backups', import.meta.url).pathname, `${stamp}${process.argv[2] ? '-' + process.argv[2] : ''}`);
mkdirSync(join(dir, 'audio'), { recursive: true });

const TABLES = ['songs', 'categories', 'rating_scale', 'app_config', 'playlists', 'playlist_songs', 'playlist_leaders'];
const manifest = { createdAt: new Date().toISOString(), tables: {}, audioFiles: 0 };

for (const table of TABLES) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows, null, 2));
  manifest.tables[table] = rows.length;
}

async function walk(prefix) {
  const { data, error } = await admin.storage.from('audio').list(prefix, { limit: 1000 });
  if (error) throw new Error(`audio list: ${error.message}`);
  for (const item of data) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      await walk(path);
    } else {
      const { data: blob, error: dlError } = await admin.storage.from('audio').download(path);
      if (dlError) throw new Error(`audio ${path}: ${dlError.message}`);
      const target = join(dir, 'audio', path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, Buffer.from(await blob.arrayBuffer()));
      manifest.audioFiles++;
    }
  }
}
await walk('');

writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(dir);
console.log(JSON.stringify(manifest, null, 2));
