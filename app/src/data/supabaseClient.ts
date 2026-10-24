import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see app/.env.example)');
}

let client: SupabaseClient | null = null;

// The unlocked database's id and password, sent with every request so row
// security can scope reads and writes to it. Read at request time (not baked
// into the client) so switching databases never needs a new client.
let databaseCredentials: { id: string; password: string } | null = null;

export function setDatabaseCredentials(credentials: { id: string; password: string } | null) {
  databaseCredentials = credentials;
}

// RLS requires an x-app-key header matching the app passphrase — the anon key
// alone (shipped in the client bundle) isn't enough. The client can't be
// created until the passphrase is known, so this is a lazy singleton
// initialized once the Passphrase Gate resolves, not at module load.
export function initSupabaseClient(appKey: string): SupabaseClient {
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { 'x-app-key': appKey },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (databaseCredentials) {
          headers.set('x-db-id', databaseCredentials.id);
          headers.set('x-db-key', databaseCredentials.password);
        }
        return fetch(input, { ...init, headers });
      },
    },
  });
  return client;
}

export function getSupabaseClient(): SupabaseClient {
  if (!client) throw new Error('Supabase client not initialized — call initSupabaseClient() first');
  return client;
}
