// Sets (or changes) the two access codes, stored hashed in access_codes:
//   CREATE_CODE — needed to create a new database
//   ADMIN_CODE  — needed to edit global settings (rating scale, genre values)
// The codes come from the environment so they never land in a file or in git.
// Usage (from scripts/):
//   CREATE_CODE=... ADMIN_CODE=... node set-access-codes.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('./.env', import.meta.url), 'utf8');
const url = env.match(/SUPABASE_URL=(.+)/)?.[1].trim();
const key = env.match(/SERVICE_ROLE_KEY=(.+)/)?.[1].trim();
const admin = createClient(url, key);

const codes = { create_database: process.env.CREATE_CODE, global_admin: process.env.ADMIN_CODE };
let changed = 0;
for (const [kind, code] of Object.entries(codes)) {
  if (!code) continue;
  const { error } = await admin.rpc('set_access_code', { p_kind: kind, p_code: code });
  if (error) throw new Error(`${kind}: ${error.message}`);
  console.log(`set ${kind}`);
  changed++;
}
if (!changed) console.log('Nothing to do — set CREATE_CODE and/or ADMIN_CODE.');
