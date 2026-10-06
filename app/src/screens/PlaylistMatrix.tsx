import { useMemo } from 'react';
import type { PlaylistHistory } from '../types';

interface PlaylistMatrixProps {
  history: PlaylistHistory;
  onBack: () => void;
}

export default function PlaylistMatrix({ history, onBack }: PlaylistMatrixProps) {
  const { playlists, songs, appearances } = history;

  const appearanceByCell = useMemo(() => {
    const map = new Map<string, { leader: string | null; position: number }>();
    for (const a of appearances) map.set(`${a.playlistId}:${a.songId}`, a);
    return map;
  }, [appearances]);

  const timesPlayed = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of appearances) counts.set(a.songId, (counts.get(a.songId) ?? 0) + 1);
    return counts;
  }, [appearances]);

  return (
    <div className="screen matrix">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back to playlists
      </button>

      <h2>Song history</h2>
      <p className="modal-subtitle">
        {songs.length} song{songs.length === 1 ? '' : 's'} that have appeared on a playlist. A dot means it was on that
        playlist; the letter is who led it, if one was set.
      </p>

      <div className="matrix-scroll pm-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th className="matrix-corner pm-corner">Playlist</th>
              {songs.map((song) => (
                <th key={song.songId} className="pm-song-header" title={`${song.title} — ${song.artist}`}>
                  <span className="pm-song-title">{song.title}</span>
                </th>
              ))}
            </tr>
            <tr>
              <th className="matrix-corner pm-corner pm-corner-sub">Times played</th>
              {songs.map((song) => (
                <th key={song.songId} className="pm-count-header">
                  {timesPlayed.get(song.songId) ?? 0}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {playlists.map((playlist) => (
              <tr key={playlist.id}>
                <th className="matrix-row-header" scope="row">
                  <span className="song-title">{playlist.name}</span>
                </th>
                {songs.map((song) => {
                  const hit = appearanceByCell.get(`${playlist.id}:${song.songId}`);
                  return (
                    <td key={song.songId} className="pm-cell">
                      {hit && (
                        <span
                          className="pm-dot"
                          title={`${song.title} — #${hit.position}${hit.leader ? `, led by ${hit.leader}` : ''}`}
                          aria-label={`${song.title} was on ${playlist.name}${hit.leader ? `, led by ${hit.leader}` : ''}`}
                        >
                          {hit.leader ? hit.leader.charAt(0).toUpperCase() : ''}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
