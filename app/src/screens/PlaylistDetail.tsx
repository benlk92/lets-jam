import { useState } from 'react';
import type { PlaylistDetail, Song } from '../types';

interface PlaylistDetailProps {
  playlist: PlaylistDetail;
  allSongs: Song[];
  leaders: string[];
  onRename: (name: string) => void;
  onDelete: () => void;
  onSetLeader: (songId: string, leader: string | null) => void;
  onReorder: (orderedSongIds: string[]) => void;
  onRemoveSong: (songId: string) => void;
  onAddSong: (songId: string) => void;
  onLoadIntoQueue: () => void;
  onBack: () => void;
}

const SONG_SEARCH_LIMIT = 20;

export default function PlaylistDetailScreen({
  playlist,
  allSongs,
  leaders,
  onRename,
  onDelete,
  onSetLeader,
  onReorder,
  onRemoveSong,
  onAddSong,
  onLoadIntoQueue,
  onBack,
}: PlaylistDetailProps) {
  const [editingName, setEditingName] = useState(false);
  const [songQuery, setSongQuery] = useState('');

  const playlistSongIds = new Set(playlist.songs.map((s) => s.songId));
  const trimmedQuery = songQuery.trim().toLowerCase();
  const songMatches = trimmedQuery
    ? allSongs.filter(
        (s) =>
          !playlistSongIds.has(s.id) &&
          (s.title.toLowerCase().includes(trimmedQuery) || s.artist.toLowerCase().includes(trimmedQuery)),
      )
    : [];

  function moveSong(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= playlist.songs.length) return;
    const next = [...playlist.songs];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next.map((s) => s.songId));
  }

  function handleDelete() {
    const confirmed = window.confirm(`Delete "${playlist.name}"? This can't be undone.`);
    if (confirmed) onDelete();
  }

  return (
    <div className="screen playlist-detail">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back to playlists
      </button>

      {editingName ? (
        <input
          autoFocus
          className="settings-category-name-input"
          defaultValue={playlist.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name) onRename(name);
            setEditingName(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      ) : (
        <button type="button" className="playlist-detail-name" onClick={() => setEditingName(true)}>
          {playlist.name}
        </button>
      )}

      <div className="playlist-detail-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onLoadIntoQueue}>
          Load into Queue
        </button>
        <button type="button" className="btn btn-danger btn-small" onClick={handleDelete}>
          Delete Playlist
        </button>
      </div>

      <ul className="song-list playlist-song-list">
        {playlist.songs.map((song, index) => (
          <li key={song.songId} className="song-row playlist-song-row">
            <div className="settings-reorder">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => moveSong(index, -1)}
                aria-label={`Move ${song.title} up`}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === playlist.songs.length - 1}
                onClick={() => moveSong(index, 1)}
                aria-label={`Move ${song.title} down`}
              >
                ↓
              </button>
            </div>
            <div className="song-row-info">
              <span className="song-title">{song.title}</span>
              <span className="song-artist">{song.artist}</span>
            </div>
            <select
              className="playlist-song-leader"
              value={song.leader ?? ''}
              onChange={(e) => onSetLeader(song.songId, e.target.value || null)}
            >
              <option value="">No leader</option>
              {leaders.map((leader) => (
                <option key={leader} value={leader}>
                  {leader}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              onClick={() => onRemoveSong(song.songId)}
              aria-label={`Remove ${song.title} from playlist`}
            >
              ×
            </button>
          </li>
        ))}
        {playlist.songs.length === 0 && <li className="song-list-empty">No songs in this playlist yet.</li>}
      </ul>

      <section className="settings-section">
        <h2>Add a Song</h2>
        <input
          className="settings-song-search"
          type="search"
          placeholder="Search title or artist…"
          value={songQuery}
          onChange={(e) => setSongQuery(e.target.value)}
        />
        {trimmedQuery && (
          <div className="settings-song-results">
            {songMatches.length === 0 && <p className="chip-group-empty">No songs match "{songQuery.trim()}".</p>}
            {songMatches.slice(0, SONG_SEARCH_LIMIT).map((song) => (
              <button
                key={song.id}
                type="button"
                className="settings-song-result"
                onClick={() => {
                  onAddSong(song.id);
                  setSongQuery('');
                }}
              >
                <span className="song-title">{song.title}</span>
                <span className="song-artist">{song.artist}</span>
              </button>
            ))}
            {songMatches.length > SONG_SEARCH_LIMIT && (
              <p className="settings-song-more">
                +{songMatches.length - SONG_SEARCH_LIMIT} more — narrow your search to see them
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
