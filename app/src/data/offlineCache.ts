import type { Category, RatingScaleEntry, Song } from '../types';

// One snapshot per database — opening a database requires a live
// connection (it re-fetches), but keying by database stops one database's
// cache from showing through while offline in another.
function snapshotKey(databaseId: string): string {
  return `songapp:cache:v2:${databaseId}`;
}
// v2: each queued write remembers which database it belongs to, so it is
// only ever replayed into that database.
const QUEUE_KEY = 'songapp:pendingWrites:v2';

export interface Snapshot {
  songs: Song[];
  categories: Category[];
  ratingScale: RatingScaleEntry[];
}

export type PendingWriteInput =
  | { type: 'rate'; dbId: string; songId: string; ratingLabel: string }
  | { type: 'memorized'; dbId: string; songId: string; memorized: boolean };

export type PendingWrite = PendingWriteInput & { id: string; queuedAt: string };

export function saveSnapshot(databaseId: string, snapshot: Snapshot) {
  try {
    localStorage.setItem(snapshotKey(databaseId), JSON.stringify(snapshot));
  } catch {
    // Storage unavailable or full — offline fallback just won't have data;
    // online usage is unaffected.
  }
}

export function loadSnapshot(databaseId: string): Snapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(databaseId));
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

export function updateCachedSong(databaseId: string, song: Song) {
  const snapshot = loadSnapshot(databaseId);
  if (!snapshot) return;
  saveSnapshot(databaseId, {
    ...snapshot,
    songs: snapshot.songs.map((s) => (s.id === song.id ? song : s)),
  });
}

export function getPendingWrites(): PendingWrite[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingWrite[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingWrite[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Best-effort — if storage is unavailable the write is still applied
    // optimistically in memory, it just won't survive a reload.
  }
}

export function enqueuePendingWrite(op: PendingWriteInput): PendingWrite {
  const entry: PendingWrite = { ...op, id: crypto.randomUUID(), queuedAt: new Date().toISOString() };
  saveQueue([...getPendingWrites(), entry]);
  return entry;
}

export function removePendingWrite(id: string) {
  saveQueue(getPendingWrites().filter((w) => w.id !== id));
}

// A request that never reached the server (no connection) is what we treat
// as "offline" — distinct from one that reached it and got a real error
// (bad RLS, bad input), which should still fail loudly. The raw browser
// fetch failure is a TypeError, but supabase-js's postgrest client catches
// that and re-wraps it in its own error shape, so `instanceof TypeError`
// alone misses it — checking the message text catches both, across
// browsers ("Failed to fetch" in Chrome, "NetworkError…" in Firefox, "Load
// failed" in Safari).
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && /fetch|network|load failed/i.test(message);
}
