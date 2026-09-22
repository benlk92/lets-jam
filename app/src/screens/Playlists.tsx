import type { PlaylistSummary } from '../types';

interface PlaylistsProps {
  playlists: PlaylistSummary[];
  onOpenPlaylist: (playlistId: string) => void;
  onBack: () => void;
}

export default function Playlists({ playlists, onOpenPlaylist, onBack }: PlaylistsProps) {
  return (
    <div className="screen playlists">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back to results
      </button>

      <h2>Playlists</h2>
      <p className="modal-subtitle">Saved song lists — build one from the Song Queue screen, then reorder it here.</p>

      <ul className="song-list">
        {playlists.map((playlist) => (
          <li key={playlist.id} className="song-row">
            <button type="button" className="song-row-main" onClick={() => onOpenPlaylist(playlist.id)}>
              <span className="song-title">{playlist.name}</span>
              <span className="song-artist">
                {playlist.songCount} song{playlist.songCount === 1 ? '' : 's'}
              </span>
            </button>
          </li>
        ))}
        {playlists.length === 0 && (
          <li className="song-list-empty">No playlists yet — save one from the Song Queue screen.</li>
        )}
      </ul>
    </div>
  );
}
