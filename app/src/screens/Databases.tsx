import { useState, type FormEvent } from 'react';
import type { DatabaseInfo } from '../types';

interface DatabasesProps {
  databases: DatabaseInfo[];
  // Databases whose password this device already knows — one tap to open.
  unlockedIds: Set<string>;
  currentId: string | null;
  canCreate: boolean;
  onOpen: (database: DatabaseInfo) => void;
  // Resolves to an error message, or null once the database is unlocked (the
  // caller opens it).
  onUnlock: (database: DatabaseInfo, password: string) => Promise<string | null>;
  onCreate: (name: string, password: string, ugSearchFallback: boolean) => Promise<string | null>;
  onOpenGlobalSettings: () => void;
  onBack: (() => void) | null;
}

function UnlockForm({
  database,
  onUnlock,
  onCancel,
}: {
  database: DatabaseInfo;
  onUnlock: DatabasesProps['onUnlock'];
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password || checking) return;
    setChecking(true);
    setError(null);
    const message = await onUnlock(database, password);
    setChecking(false);
    if (message) setError(message);
  }

  return (
    <form className="db-unlock-form" onSubmit={handleSubmit}>
      <input
        type="password"
        autoFocus
        className="passphrase-input"
        placeholder={`Password for ${database.name}`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="db-unlock-actions">
        <button type="submit" className="btn btn-primary" disabled={checking || !password}>
          {checking ? 'Checking…' : 'Unlock'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="passphrase-error">{error}</p>}
    </form>
  );
}

export default function Databases({
  databases,
  unlockedIds,
  currentId,
  canCreate,
  onOpen,
  onUnlock,
  onCreate,
  onOpenGlobalSettings,
  onBack,
}: DatabasesProps) {
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [ugSearch, setUgSearch] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !password || creating) return;
    setCreating(true);
    setCreateError(null);
    const message = await onCreate(name.trim(), password, ugSearch);
    setCreating(false);
    if (message) setCreateError(message);
  }

  return (
    <div className="screen databases">
      {onBack && (
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
      )}

      <h1>Let's Jam 🎸</h1>
      <p className="modal-subtitle">Pick a database. Each one has its own password.</p>

      <ul className="song-list">
        {databases.map((database) => {
          const unlocked = unlockedIds.has(database.id);
          return (
            <li key={database.id} className="db-card">
              <div className="db-card-row">
                <div className="db-card-name">
                  <span className="song-title">{database.name}</span>
                  {database.id === currentId && <span className="queued-badge">Open now</span>}
                </div>
                {unlocked ? (
                  <button type="button" className="btn btn-primary btn-small" onClick={() => onOpen(database)}>
                    Open
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => setUnlockingId(unlockingId === database.id ? null : database.id)}
                  >
                    🔒 Unlock
                  </button>
                )}
              </div>
              {unlockingId === database.id && !unlocked && (
                <UnlockForm database={database} onUnlock={onUnlock} onCancel={() => setUnlockingId(null)} />
              )}
            </li>
          );
        })}
        {databases.length === 0 && <li className="song-list-empty">No databases yet.</li>}
      </ul>

      {canCreate && (
        <section className="settings-section">
          {showCreate ? (
            <form className="db-create-form" onSubmit={handleCreate}>
              <h2>New database</h2>
              <input
                className="settings-add-name"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <input
                type="password"
                className="settings-add-name"
                placeholder="Password for this database"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label className="settings-toggle">
                <input type="checkbox" checked={ugSearch} onChange={(e) => setUgSearch(e.target.checked)} />
                Songs here mostly come from Ultimate Guitar
              </label>
              <p className="modal-subtitle">
                A new database starts empty. Add songs, or bring in existing ones from the shared library.
              </p>
              <div className="db-unlock-actions">
                <button type="submit" className="btn btn-primary" disabled={creating || !name.trim() || !password}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
              </div>
              {createError && <p className="passphrase-error">{createError}</p>}
            </form>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(true)}>
              + New database
            </button>
          )}
        </section>
      )}

      <button type="button" className="btn btn-link" onClick={onOpenGlobalSettings}>
        Global settings
      </button>
    </div>
  );
}
