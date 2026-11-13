import { useEffect, useMemo, useState } from 'react';
import type { DatabaseInfo } from '../types';
import { fetchDatabaseSongIds, fetchLibrary, type LibraryEntry } from '../data/store';
import PasswordDialog from './PasswordDialog';

interface LibraryProps {
  databases: DatabaseInfo[];
  // Databases whose password this device already knows.
  unlockedIds: Set<string>;
  initialDatabaseId: string | null;
  // Resolves to an error message, or null once the password is accepted and saved.
  onUnlock: (database: DatabaseInfo, password: string) => Promise<string | null>;
  onAdd: (databaseId: string, sharedSongId: string) => Promise<boolean>;
  onBack: () => void;
}

const PAGE_SIZE = 100;
const NO_GENRE = '__none__';

// Every song in the shared library, read-only. One database is "active": rows
// already in it are dimmed with a check, and + adds the rest to it.
export default function Library({ databases, unlockedIds, initialDatabaseId, onUnlock, onAdd, onBack }: LibraryProps) {
  const [library, setLibrary] = useState<LibraryEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [activeId, setActiveId] = useState<string>(
    databases.find((d) => d.id === initialDatabaseId)?.id ?? databases[0]?.id ?? '',
  );
  const [haveFor, setHaveFor] = useState<{ databaseId: string; ids: Set<string> } | null>(null);
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('');
  const [hideHave, setHideHave] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [pending, setPending] = useState<string | null>(null);
  // A + tapped on a locked database waits here for its password.
  const [unlockFor, setUnlockFor] = useState<string | null>(null);

  const active = databases.find((d) => d.id === activeId) ?? null;
  const activeUnlocked = !!active && unlockedIds.has(active.id);

  useEffect(() => {
    let cancelled = false;
    fetchLibrary()
      .then((rows) => !cancelled && setLibrary(rows))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    fetchDatabaseSongIds(activeId)
      .then((ids) => !cancelled && setHaveFor({ databaseId: activeId, ids }))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Until the active database's list arrives, nothing is marked as already there.
  const have = useMemo(
    () => (haveFor?.databaseId === activeId ? haveFor.ids : new Set<string>()),
    [haveFor, activeId],
  );

  const genres = useMemo(
    () => Array.from(new Set((library ?? []).map((s) => s.genre).filter((g): g is string => !!g))).sort(),
    [library],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (library ?? []).filter((s) => {
      if (hideHave && have.has(s.sharedSongId)) return false;
      if (genre === NO_GENRE ? s.genre : genre && s.genre !== genre) return false;
      if (q && !s.title.toLowerCase().includes(q) && !s.artist.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [library, have, query, genre, hideHave]);

  const notHaveCount = library ? library.filter((s) => !have.has(s.sharedSongId)).length : 0;

  async function add(sharedSongId: string) {
    if (!active) return;
    setPending(sharedSongId);
    const ok = await onAdd(active.id, sharedSongId);
    setPending(null);
    if (ok) setHaveFor({ databaseId: active.id, ids: new Set(have).add(sharedSongId) });
  }

  const [waitingSongId, setWaitingSongId] = useState<string | null>(null);

  function handlePlus(sharedSongId: string) {
    if (activeUnlocked) {
      add(sharedSongId);
    } else {
      setWaitingSongId(sharedSongId);
      setUnlockFor(activeId);
    }
  }

  async function handleUnlockSubmit(password: string): Promise<string | null> {
    const target = databases.find((d) => d.id === unlockFor);
    if (!target) return 'No database selected.';
    const message = await onUnlock(target, password);
    if (message) return message;
    setUnlockFor(null);
    // The password is saved synchronously, so the pending add can go ahead now.
    if (waitingSongId) {
      const id = waitingSongId;
      setWaitingSongId(null);
      await add(id);
    }
    return null;
  }

  return (
    <div className="screen library">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back
      </button>

      <h1>All songs</h1>
      <p className="modal-subtitle">
        Every song in the shared library. Pick a database, then tap + to add a song to it.
      </p>

      <label className="library-active">
        <span>Adding to</span>
        <select value={activeId} onChange={(e) => {
            setActiveId(e.target.value);
            setVisible(PAGE_SIZE);
          }}>
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {active && !activeUnlocked && <span className="library-lock">🔒 Edit to add</span>}
      </label>

      <input
        className="url-input"
        type="search"
        value={query}
        placeholder="Search by title or artist…"
        onChange={(e) => {
          setQuery(e.target.value);
          setVisible(PAGE_SIZE);
        }}
      />

      <div className="library-filters">
        <select value={genre} onChange={(e) => {
            setGenre(e.target.value);
            setVisible(PAGE_SIZE);
          }} aria-label="Genre">
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
          <option value={NO_GENRE}>No genre</option>
        </select>
        <label className="settings-toggle">
          <input type="checkbox" checked={hideHave} onChange={(e) => {
              setHideHave(e.target.checked);
              setVisible(PAGE_SIZE);
            }} />
          Only songs not in {active?.name ?? 'this database'}
        </label>
      </div>

      {loadError && <p className="passphrase-error">Couldn't load the library — check your connection and try again.</p>}
      {!library && !loadError && <p className="modal-subtitle">Loading…</p>}

      {library && (
        <>
          <p className="library-count">
            {filtered.length} song{filtered.length === 1 ? '' : 's'}
            {active && ` · ${notHaveCount} not in ${active.name}`}
          </p>
          <ul className="match-list">
            {filtered.slice(0, visible).map((song) => {
              const here = have.has(song.sharedSongId);
              return (
                <li key={song.sharedSongId} className={`match-row library-row${here ? ' library-row-have' : ''}`}>
                  <div className="match-info">
                    <span className="song-title">{song.title}</span>
                    <span className="song-artist">
                      {song.artist}
                      {song.genre && ` · ${song.genre}`}
                    </span>
                  </div>
                  {here ? (
                    <span className="library-have" title={`In ${active?.name}`} aria-label={`Already in ${active?.name}`}>
                      ✓
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="icon-button library-add"
                      onClick={() => handlePlus(song.sharedSongId)}
                      disabled={pending === song.sharedSongId}
                      aria-label={`Add ${song.title} to ${active?.name}`}
                    >
                      +
                    </button>
                  )}
                </li>
              );
            })}
            {filtered.length === 0 && <li className="match-empty">No songs match.</li>}
          </ul>
          {filtered.length > visible && (
            <button type="button" className="btn btn-ghost" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              Show more ({filtered.length - visible} left)
            </button>
          )}
        </>
      )}

      {unlockFor && (
        <PasswordDialog
          title={`Edit ${databases.find((d) => d.id === unlockFor)?.name ?? ''}`}
          subtitle="Enter this database's password to add songs to it."
          placeholder="Password"
          onSubmit={handleUnlockSubmit}
          onCancel={() => {
            setUnlockFor(null);
            setWaitingSongId(null);
          }}
        />
      )}
    </div>
  );
}
