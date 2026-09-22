import { useState } from 'react';
import type { Category, RatingScaleEntry, Song, Space } from '../types';
import { SPACE_LABELS } from '../types';
import { GENRE_CATEGORY_ID } from '../lib/filtering';
import ManageValues from './ManageValues';

interface SettingsProps {
  space: Space;
  onSwitchSpace: (space: Space) => void;
  categories: Category[];
  songs: Song[];
  ratingScale: RatingScaleEntry[];
  onBack: () => void;
  onAddCategory: (name: string) => void;
  onRenameCategory: (id: string, name: string) => void;
  onRetireCategory: (id: string) => void;
  onReorderCategories: (orderedIds: string[]) => void;
  onToggleGuidedPicker: (id: string, enabled: boolean) => void;
  onToggleScatterPicker: (id: string, enabled: boolean) => void;
  onRenameValue: (categoryId: string, oldValue: string, newValue: string) => void;
  onDeleteValue: (categoryId: string, value: string) => void;
  onAddValue: (categoryId: string, value: string) => void;
  onReorderValue: (categoryId: string, orderedValues: string[]) => void;
  onStartGapFill: (categoryId: string) => void;
  onAddRating: (label: string, intervalDays: number) => void;
  onUpdateRating: (oldLabel: string, next: RatingScaleEntry) => void;
  onRemoveRating: (label: string) => void;
  onSelectSong: (song: Song) => void;
  onOpenAddSong: () => void;
  openUgOnTap: boolean;
  onToggleOpenUgOnTap: (value: boolean) => void;
  leaders: string[];
  onAddLeader: (name: string) => void;
  onRenameLeader: (oldName: string, newName: string) => void;
  onRemoveLeader: (name: string) => void;
  onReorderLeaders: (orderedNames: string[]) => void;
}

const SONG_SEARCH_LIMIT = 20;

export default function Settings({
  space,
  onSwitchSpace,
  categories,
  songs,
  ratingScale,
  onBack,
  onAddCategory,
  onRenameCategory,
  onRetireCategory,
  onReorderCategories,
  onToggleGuidedPicker,
  onToggleScatterPicker,
  onRenameValue,
  onDeleteValue,
  onAddValue,
  onReorderValue,
  onStartGapFill,
  onAddRating,
  onUpdateRating,
  onRemoveRating,
  onSelectSong,
  onOpenAddSong,
  openUgOnTap,
  onToggleOpenUgOnTap,
  leaders,
  onAddLeader,
  onRenameLeader,
  onRemoveLeader,
  onReorderLeaders,
}: SettingsProps) {
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [valuesModalCategoryId, setValuesModalCategoryId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newRatingLabel, setNewRatingLabel] = useState('');
  const [newRatingInterval, setNewRatingInterval] = useState('');
  const [songQuery, setSongQuery] = useState('');
  const [editingLeader, setEditingLeader] = useState<string | null>(null);
  const [newLeaderName, setNewLeaderName] = useState('');

  const valuesModalCategory = categories.find((c) => c.id === valuesModalCategoryId) ?? null;

  const trimmedSongQuery = songQuery.trim().toLowerCase();
  const songMatches = trimmedSongQuery
    ? songs.filter(
        (s) => s.title.toLowerCase().includes(trimmedSongQuery) || s.artist.toLowerCase().includes(trimmedSongQuery),
      )
    : [];

  function moveCategory(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    onReorderCategories(next.map((c) => c.id));
  }

  function moveLeader(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= leaders.length) return;
    const next = [...leaders];
    [next[index], next[target]] = [next[target], next[index]];
    onReorderLeaders(next);
  }

  function handleAddLeader() {
    const name = newLeaderName.trim();
    if (!name) return;
    onAddLeader(name);
    setNewLeaderName('');
  }

  function handleRemoveLeader(name: string) {
    const confirmed = window.confirm(
      `Remove "${name}" from the leaders list? Any playlist song currently assigned to them will show no leader instead.`,
    );
    if (confirmed) onRemoveLeader(name);
  }

  function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    onAddCategory(name);
    setNewCategoryName('');
  }

  function handleAddRating() {
    const label = newRatingLabel.trim();
    const intervalDays = Number(newRatingInterval);
    if (!label || !Number.isFinite(intervalDays)) return;
    onAddRating(label, intervalDays);
    setNewRatingLabel('');
    setNewRatingInterval('');
  }

  function handleRetireCategory(category: Category) {
    const confirmed = window.confirm(
      `Retire "${category.name}"? It'll disappear from Guided Picker, Filters, and Sort. Songs keep whatever value they already had, but you won't be able to see or edit it anymore.`,
    );
    if (confirmed) onRetireCategory(category.id);
  }

  function handleRemoveRating(label: string) {
    const confirmed = window.confirm(
      `Remove "${label}" from the rating scale? Songs already rated ${label} keep that rating, but it won't count toward staleness or show up as an option to pick again.`,
    );
    if (confirmed) onRemoveRating(label);
  }

  return (
    <div className="screen settings">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back to results
      </button>

      <section className="settings-section">
        <button type="button" className="btn btn-primary" onClick={onOpenAddSong}>
          + Add Song
        </button>
      </section>

      <section className="settings-section">
        <h2>Database</h2>
        <p className="modal-subtitle">
          Two separate song libraries — categories, tags, and songs never mix between them.
        </p>
        <div className="settings-space-toggle">
          {(Object.keys(SPACE_LABELS) as Space[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`btn ${s === space ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => onSwitchSpace(s)}
            >
              {SPACE_LABELS[s]}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>Song List Behavior</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={openUgOnTap}
            onChange={(e) => onToggleOpenUgOnTap(e.target.checked)}
          />
          Open the Ultimate Guitar link when opening a song's rating screen
        </label>
        <p className="modal-subtitle">
          {openUgOnTap
            ? "Opening a song's rating screen also opens its chords/lyrics."
            : "Opening a song's rating screen only opens the rating screen — the link stays available there."}
        </p>
      </section>

      <section className="settings-section">
        <h2>Find a Song</h2>
        <p className="modal-subtitle">Jump straight to a song's assessment by title or artist.</p>
        <input
          className="settings-song-search"
          type="search"
          placeholder="Search title or artist…"
          value={songQuery}
          onChange={(e) => setSongQuery(e.target.value)}
        />
        {trimmedSongQuery && (
          <div className="settings-song-results">
            {songMatches.length === 0 && <p className="chip-group-empty">No songs match "{songQuery.trim()}".</p>}
            {songMatches.slice(0, SONG_SEARCH_LIMIT).map((song) => (
              <button
                key={song.id}
                type="button"
                className="settings-song-result"
                onClick={() => onSelectSong(song)}
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

      <section className="settings-section">
        <h2>Tag Categories</h2>
        <p className="modal-subtitle">
          Order drives the Guided Picker sequence. Toggle a category off to skip it there without removing it from
          Filters or Sort. Filter Picker is a separate, opt-in screen — toggle categories into it independently.
        </p>

        <div className="settings-category-list">
          {categories.map((category, index) => (
            <div key={category.id} className="settings-category-row">
              <div className="settings-reorder">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveCategory(index, -1)}
                  aria-label={`Move ${category.name} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === categories.length - 1}
                  onClick={() => moveCategory(index, 1)}
                  aria-label={`Move ${category.name} down`}
                >
                  ↓
                </button>
              </div>

              <div className="settings-category-main">
                {editingCategoryId === category.id ? (
                  <input
                    autoFocus
                    className="settings-category-name-input"
                    defaultValue={category.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name) onRenameCategory(category.id, name);
                      setEditingCategoryId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="settings-category-name"
                    disabled={category.computed}
                    onClick={() => setEditingCategoryId(category.id)}
                  >
                    {category.name}
                  </button>
                )}
                {category.computed && category.id !== 'memorized' && (
                  <span className="settings-category-type">Computed</span>
                )}
              </div>

              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={category.guidedPickerEnabled !== false}
                  onChange={(e) => onToggleGuidedPicker(category.id, e.target.checked)}
                />
                Guided Picker
              </label>

              {category.id !== GENRE_CATEGORY_ID && (
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={category.scatterPickerEnabled === true}
                    onChange={(e) => onToggleScatterPicker(category.id, e.target.checked)}
                  />
                  Filter Picker
                </label>
              )}

              {(!category.computed || category.id === 'memorized' || category.id === 'performance_confidence') && (
                <div className="settings-category-actions">
                  {!category.computed && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => setValuesModalCategoryId(category.id)}
                    >
                      Values
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => onStartGapFill(category.id)}
                  >
                    Gap-Fill
                  </button>
                  {!category.computed && category.id !== GENRE_CATEGORY_ID && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => handleRetireCategory(category)}
                      aria-label={`Retire ${category.name}`}
                    >
                      🗑
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="settings-add-row">
          <input
            className="settings-add-name"
            placeholder="New category name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
          <button type="button" className="btn btn-primary" onClick={handleAddCategory}>
            Add
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Rating Scale</h2>
        <p className="modal-subtitle">
          Rating a song resets its staleness clock by this many days. Renaming a label updates every song already
          rated with it.
        </p>

        <div className="settings-rating-list">
          {ratingScale.map((entry) => (
            <div key={entry.label} className="settings-rating-row">
              <input
                className="settings-rating-label"
                defaultValue={entry.label}
                onBlur={(e) => {
                  const label = e.target.value.trim();
                  if (label && label !== entry.label) {
                    onUpdateRating(entry.label, { label, intervalDays: entry.intervalDays });
                  }
                }}
              />
              <input
                type="number"
                className="settings-rating-interval"
                defaultValue={entry.intervalDays}
                min={0}
                onBlur={(e) => {
                  const intervalDays = Number(e.target.value);
                  if (Number.isFinite(intervalDays) && intervalDays !== entry.intervalDays) {
                    onUpdateRating(entry.label, { label: entry.label, intervalDays });
                  }
                }}
              />
              <span className="settings-rating-unit">days</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => handleRemoveRating(entry.label)}
                aria-label={`Remove ${entry.label}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="settings-add-row">
          <input
            className="settings-add-name"
            placeholder="Label"
            value={newRatingLabel}
            onChange={(e) => setNewRatingLabel(e.target.value)}
          />
          <input
            type="number"
            className="settings-rating-interval"
            placeholder="Days"
            min={0}
            value={newRatingInterval}
            onChange={(e) => setNewRatingInterval(e.target.value)}
          />
          <button type="button" className="btn btn-primary" onClick={handleAddRating}>
            Add
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Playlist Leaders</h2>
        <p className="modal-subtitle">
          Shared across both databases. Shows up as the leader dropdown when assigning a leader to a song within a
          playlist.
        </p>

        <div className="settings-category-list">
          {leaders.map((leader, index) => (
            <div key={leader} className="settings-category-row">
              <div className="settings-reorder">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveLeader(index, -1)}
                  aria-label={`Move ${leader} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === leaders.length - 1}
                  onClick={() => moveLeader(index, 1)}
                  aria-label={`Move ${leader} down`}
                >
                  ↓
                </button>
              </div>

              {editingLeader === leader ? (
                <input
                  autoFocus
                  className="settings-category-name-input"
                  defaultValue={leader}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== leader) onRenameLeader(leader, name);
                    setEditingLeader(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              ) : (
                <button type="button" className="settings-category-name" onClick={() => setEditingLeader(leader)}>
                  {leader}
                </button>
              )}

              <button
                type="button"
                className="icon-button"
                onClick={() => handleRemoveLeader(leader)}
                aria-label={`Remove ${leader}`}
              >
                🗑
              </button>
            </div>
          ))}
        </div>

        <div className="settings-add-row">
          <input
            className="settings-add-name"
            placeholder="Leader name"
            value={newLeaderName}
            onChange={(e) => setNewLeaderName(e.target.value)}
          />
          <button type="button" className="btn btn-primary" onClick={handleAddLeader}>
            Add
          </button>
        </div>
      </section>

      {valuesModalCategory && (
        <ManageValues
          category={valuesModalCategory}
          songs={songs}
          onRename={(oldValue, newValue) => onRenameValue(valuesModalCategory.id, oldValue, newValue)}
          onDelete={(value) => onDeleteValue(valuesModalCategory.id, value)}
          onAdd={(value) => onAddValue(valuesModalCategory.id, value)}
          onReorder={(orderedValues) => onReorderValue(valuesModalCategory.id, orderedValues)}
          onClose={() => setValuesModalCategoryId(null)}
        />
      )}
    </div>
  );
}
