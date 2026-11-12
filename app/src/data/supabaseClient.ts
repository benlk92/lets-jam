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

// The global admin code, sent as x-admin-key so row security lets the rating
// scale and genre values be edited. Read at request time like the database
// credentials above.
let adminKey: string | null = null;

export function setAdminKey(key: string | null) {
  adminKey = key;
}

// Anyone can read; writes are checked server-side against the unlocked
// database's password (x-db-id / x-db-key) or the admin code (x-admin-key).
function createSupabaseClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (databaseCredentials) {
          headers.set('x-db-id', databaseCredentials.id);
          headers.set('x-db-key', databaseCredentials.password);
        }
        if (adminKey) headers.set('x-admin-key', adminKey);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export function getSupabaseClient(): SupabaseClient {
  if (!client) client = createSupabaseClient();
  return client;
}
