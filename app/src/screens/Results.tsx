import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, CategoryFilter, FilterState, RatingScaleEntry, Song } from '../types';
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
  onOpenPickerChooser: () => void;
  onToggleQueue: (song: Song) => void;
  onOpenAssessment: (song: Song) => void;
  onOpenChordChart: (song: Song) => void;
  queue: string[];
  canEdit: boolean;
  isRandomTen: boolean;
}

function filterLabel(category: Category, filter: CategoryFilter): string {
  if (filter.values && filter.values.length > 0) {
    return `${category.name}: ${filter.values.join(', ')}`;
  }
  return category.name;
}

export default function Results({
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
  onOpenPickerChooser,
  onToggleQueue,
  onOpenAssessment,
  onOpenChordChart,
  queue,
  canEdit,
  isRandomTen,
}: ResultsProps) {
  const [showMenu, setShowMenu] = useState(false);
  const hamburgerRef = useClickOutside(showMenu, setShowMenu);

  const activeFilterLabels = [
    ...(isRandomTen ? ['Random 10'] : []),
    ...categories.filter((c) => filters[c.id]).map((c) => filterLabel(c, filters[c.id])),
  ];

  const queuedIds = useMemo(() => new Set(queue), [queue]);

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
              <div className="song-row-info">
                <span className="song-title">{song.title}</span>
                <span className="song-artist">{song.artist}</span>
                {isQueued && <span className="queued-badge">Queued</span>}
              </div>
              {staleness && (
                <span className={`staleness-badge ${staleness.overdue ? 'staleness-overdue' : 'staleness-fresh'}`}>
                  {staleness.text}
                </span>
              )}
              <div className="song-row-actions">
                {song.chordChart ? (
                  <button
                    type="button"
                    className="icon-button song-row-ug"
                    onClick={() => onOpenChordChart(song)}
                    aria-label={`View chords and lyrics for ${song.title}`}
                  >
                    🎼
                  </button>
                ) : (
                  <a
                    className="icon-button song-row-ug"
                    href={song.ultimateGuitarUrl || buildUltimateGuitarSearchUrl(song.title)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={
                      song.ultimateGuitarUrl
                        ? `Open Ultimate Guitar tab for ${song.title}`
                        : `Search Ultimate Guitar for ${song.title}`
                    }
                  >
                    🎼
                  </a>
                )}
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
