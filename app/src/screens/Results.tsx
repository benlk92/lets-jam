import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, CategoryFilter, FilterState, PlaylistSummary, QueueEntry, RatingScaleEntry, Song } from '../types';
import { formatStaleness, stalenessDays } from '../lib/staleness';
import { buildUltimateGuitarSearchUrl } from '../lib/ultimateGuitar';

// Closes an open dropdown on a click anywhere outside its wrapper element.
// Takes the useState setter directly (rather than a callback) so its
// identity is stable across renders and the listener isn't re-attached on
// every render while the dropdown is open.
function useClickOutside(active: boolean, setActive: (value: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setActive(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [active, setActive]);
  return ref;
}

interface ResultsProps {
  // Whether songs in this database usually come from Ultimate Guitar (enables
  // the "search Ultimate Guitar" fallback for songs with no link).
  ugSearchFallback: boolean;
  songs: Song[];
  totalCount: number;
  ratingScale: RatingScaleEntry[];
  categories: Category[];
  filters: FilterState;
  includeUntagged: boolean;
  showStaleness: boolean;
  onToggleStaleness: (next: boolean) => void;
  onOpenFilters: () => void;
  onOpenSort: () => void;
  onOpenSettings: () => void;
  onOpenQueue: () => void;
  onOpenPlaylists: () => void;
  onOpenMatrix: () => void;
  onOpenAddSong: () => void;
  onOpenDatabases: () => void;
  onOpenPickerChooser: () => void;
  onToggleQueue: (song: Song) => void;
  onOpenAssessment: (song: Song) => void;
  onOpenChordChart: (song: Song) => void;
  queue: QueueEntry[];
  playlists: PlaylistSummary[];
  onAddSongToPlaylist: (playlistId: string, song: Song) => void;
  canEdit: boolean;
  isRandomTen: boolean;
  search: string;
  onSearchChange: (value: string) => void;
}

function filterLabel(category: Category, filter: CategoryFilter): string {
  if (filter.values && filter.values.length > 0) {
    return `${category.name}: ${filter.values.join(', ')}`;
  }
  return category.name;
}

export default function Results({
  ugSearchFallback,
  songs,
  totalCount,
  ratingScale,
  categories,
  filters,
  includeUntagged,
  showStaleness,
  onToggleStaleness,
  onOpenFilters,
  onOpenSort,
  onOpenSettings,
  onOpenQueue,
  onOpenPlaylists,
  onOpenMatrix,
  onOpenAddSong,
  onOpenDatabases,
  onOpenPickerChooser,
  onToggleQueue,
  onOpenAssessment,
  onOpenChordChart,
  queue,
  playlists,
  onAddSongToPlaylist,
  canEdit,
  isRandomTen,
  search,
  onSearchChange,
}: ResultsProps) {
  const [showMenu, setShowMenu] = useState(false);
  const hamburgerRef = useClickOutside(showMenu, setShowMenu);
  const isPopSongs = ugSearchFallback;

  const [playlistPickerSongId, setPlaylistPickerSongId] = useState<string | null>(null);
  const playlistPickerRef = useClickOutside(playlistPickerSongId !== null, () => setPlaylistPickerSongId(null));

  const activeFilterLabels = [
    ...(isRandomTen ? ['Random 10'] : []),
    ...categories.filter((c) => filters[c.id]).map((c) => filterLabel(c, filters[c.id])),
  ];

  const queuedIds = useMemo(() => new Set(queue.map((e) => e.songId)), [queue]);

  // Tapping a song goes straight to the most useful thing for it: its saved
  // lyrics/recordings, else its Ultimate Guitar page (or a search for it in
  // Pop Songs), else — with nothing to show — the rating screen.
  function openSong(song: Song) {
    if (song.chordChart || song.recordings.length > 0) {
      onOpenChordChart(song);
    } else if (song.ultimateGuitarUrl) {
      window.open(song.ultimateGuitarUrl, '_blank', 'noopener');
    } else if (isPopSongs) {
      window.open(buildUltimateGuitarSearchUrl(song.title), '_blank', 'noopener');
    } else if (canEdit) {
      onOpenAssessment(song);
    }
  }

  return (
    <div className="screen results">
      <div className="results-toolbar">
        <div className="results-toolbar-row">
          <div className="start-over-wrap">
            <button type="button" className="btn btn-primary btn-large" onClick={onOpenPickerChooser}>
              Find More Songs
            </button>
          </div>
          {canEdit && (
            <div className="hamburger-wrap" ref={hamburgerRef}>
              <button
                type="button"
                className="hamburger-button"
                onClick={() => setShowMenu((v) => !v)}
                aria-label="Menu"
              >
                ☰
              </button>
              {showMenu && (
                <div className="dropdown-menu dropdown-menu-right">
                  <button
                    type="button"
                    className="dropdown-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      onOpenDatabases();
                    }}
                  >
                    Switch database
                  </button>
                  <button
                    type="button"
                    className="dropdown-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      onOpenSettings();
                    }}
                  >
                    Settings
                  </button>
                  <button
                    type="button"
                    className="dropdown-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      onOpenQueue();
                    }}
                  >
                    Song Queue{queue.length > 0 ? ` (${queue.length})` : ''}
                  </button>
                  <button
                    type="button"
                    className="dropdown-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      onOpenPlaylists();
                    }}
                  >
                    Playlists{playlists.length > 0 ? ` (${playlists.length})` : ''}
                  </button>
                  <button
                    type="button"
                    className="dropdown-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      onOpenMatrix();
                    }}
                  >
                    Matrix
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="results-toolbar-row">
          <button type="button" className="btn btn-ghost btn-small" onClick={onOpenFilters}>
            Filters
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={onOpenSort}>
            Sort
          </button>
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-small" onClick={onOpenAddSong}>
              Add
            </button>
          )}
          <input
            type="text"
            className="results-search"
            placeholder="Search"
            aria-label="Search songs by title or artist"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      </div>

      {activeFilterLabels.length > 0 && (
        <button type="button" className="active-filters" onClick={onOpenFilters}>
          {activeFilterLabels.map((label) => (
            <span key={label} className="active-filter-chip">
              {label}
            </span>
          ))}
          {includeUntagged && <span className="active-filter-chip active-filter-chip-muted">+ untagged included</span>}
        </button>
      )}

      <div className="results-subbar">
        <p className="results-count">
          {songs.length} of {totalCount} songs
        </p>
        {canEdit && (
          <label className="staleness-toggle">
            <input
              type="checkbox"
              checked={showStaleness}
              onChange={(e) => onToggleStaleness(e.target.checked)}
            />
            Show staleness (memorized only)
          </label>
        )}
      </div>

      <ul className="song-list">
        {songs.map((song) => {
          // Non-memorized songs have no staleness — nothing to decay if
          // you're reading it off the chart — so they just show no badge.
          const days = showStaleness ? stalenessDays(song, ratingScale) : null;
          const staleness = days != null ? formatStaleness(days) : null;
          const isQueued = canEdit && queuedIds.has(song.id);
          return (
            <li key={song.id} className={`song-row ${isQueued ? 'song-row-queued' : ''}`}>
              <button type="button" className="song-row-main song-row-open" onClick={() => openSong(song)}>
                <span className="song-title">{song.title}</span>
                <span className="song-artist">{song.artist}</span>
                {isQueued && <span className="queued-badge">Queued</span>}
              </button>
              {staleness && (
                <span className={`staleness-badge ${staleness.overdue ? 'staleness-overdue' : 'staleness-fresh'}`}>
                  {staleness.text}
                </span>
              )}
              <div className="song-row-actions">
                {canEdit && (
                  <button
                    type="button"
                    className="icon-button song-row-menu"
                    onClick={() => onOpenAssessment(song)}
                    aria-label={`Rate ${song.title}`}
                  >
                    ⋮
                  </button>
                )}
                {canEdit && playlists.length > 0 && (
                  <div
                    className="song-row-playlist-picker-wrap"
                    ref={playlistPickerSongId === song.id ? playlistPickerRef : undefined}
                  >
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setPlaylistPickerSongId((id) => (id === song.id ? null : song.id))}
                      aria-label={`Add ${song.title} to a playlist`}
                    >
                      📋
                    </button>
                    {playlistPickerSongId === song.id && (
                      <div className="dropdown-menu dropdown-menu-right dropdown-menu-row">
                        {playlists.map((playlist) => (
                          <button
                            key={playlist.id}
                            type="button"
                            className="dropdown-menu-item"
                            onClick={() => {
                              onAddSongToPlaylist(playlist.id, song);
                              setPlaylistPickerSongId(null);
                            }}
                          >
                            {playlist.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className={`icon-button song-row-queue-btn ${isQueued ? 'song-row-queue-btn-active' : ''}`}
                    onClick={() => onToggleQueue(song)}
                    aria-label={isQueued ? `Remove ${song.title} from queue` : `Add ${song.title} to queue`}
                  >
                    {isQueued ? '✓' : '+'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {songs.length === 0 && <li className="song-list-empty">No songs match these filters.</li>}
      </ul>
    </div>
  );
}
