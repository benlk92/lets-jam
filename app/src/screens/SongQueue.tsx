import { useState } from 'react';
import type { Song } from '../types';

interface SongQueueProps {
  songs: Song[];
  importedFromPlaylistName: string | null;
  onSelectSong: (song: Song) => void;
  onRemove: (songId: string) => void;
  onSaveAsNew: (name: string) => void;
  onUpdatePlaylist: () => void;
  onBack: () => void;
}

export default function SongQueue({
  songs,
  importedFromPlaylistName,
  onSelectSong,
  onRemove,
  onSaveAsNew,
  onUpdatePlaylist,
  onBack,
}: SongQueueProps) {
  const [newName, setNewName] = useState('');

  function handleSaveAsNew() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onSaveAsNew(trimmed);
    setNewName('');
  }

  return (
    <div className="screen song-queue">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back to results
      </button>

      <h2>Song Queue</h2>
      <p className="modal-subtitle">Tap a song to rate it, or tap × to remove it without rating.</p>

      <ul className="song-list queue-list">
        {songs.map((song) => (
          <li key={song.id} className="song-row">
            <button type="button" className="song-row-main" onClick={() => onSelectSong(song)}>
              <span className="song-title">{song.title}</span>
              <span className="song-artist">{song.artist}</span>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => onRemove(song.id)}
              aria-label={`Remove ${song.title} from queue`}
            >
              ×
            </button>
          </li>
        ))}
        {songs.length === 0 && (
          <li className="song-list-empty">Queue is empty — tap songs on Results to add them.</li>
        )}
      </ul>

      {songs.length > 0 && (
        <section className="settings-section queue-save-section">
          <h2>Save Playlist</h2>
          {importedFromPlaylistName && (
            <button type="button" className="btn btn-primary" onClick={onUpdatePlaylist}>
              Update "{importedFromPlaylistName}"
            </button>
          )}
          <div className="settings-add-row">
            <input
              className="settings-add-name"
              placeholder="Playlist name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="button" className="btn btn-ghost" onClick={handleSaveAsNew}>
              {importedFromPlaylistName ? 'Save as New' : 'Save'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
