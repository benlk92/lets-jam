import { useState } from 'react';
import type { Category, RatingScaleEntry, Song } from '../types';
import { GENRE_CATEGORY_ID } from '../lib/filtering';
import ManageValues from './ManageValues';

interface GlobalSettingsProps {
  ratingScale: RatingScaleEntry[];
  genreValues: string[];
  // Songs in the open database, if any — only used to show how many songs a
  // genre value affects there.
  songs: Song[];
  canEdit: boolean;
  onAddRating: (label: string, intervalDays: number) => void;
  onUpdateRating: (oldLabel: string, next: RatingScaleEntry) => void;
  onRemoveRating: (label: string) => void;
  onRenameGenre: (oldValue: string, newValue: string) => void;
  onDeleteGenre: (value: string) => void;
  onAddGenre: (value: string) => void;
  onReorderGenre: (orderedValues: string[]) => void;
  onBack: () => void;
}

export default function GlobalSettings({
  ratingScale,
  genreValues,
  songs,
  canEdit,
  onAddRating,
  onUpdateRating,
  onRemoveRating,
  onRenameGenre,
  onDeleteGenre,
  onAddGenre,
  onReorderGenre,
  onBack,
}: GlobalSettingsProps) {
  const [newRatingLabel, setNewRatingLabel] = useState('');
  const [newRatingInterval, setNewRatingInterval] = useState('');
  const [showGenreValues, setShowGenreValues] = useState(false);

  const genreCategory: Category = { id: GENRE_CATEGORY_ID, name: 'Genre', values: genreValues };

  function handleAddRating() {
    const label = newRatingLabel.trim();
    const intervalDays = Number(newRatingInterval);
    if (!label || !newRatingInterval.trim() || !Number.isFinite(intervalDays) || intervalDays < 0) return;
    onAddRating(label, intervalDays);
    setNewRatingLabel('');
    setNewRatingInterval('');
  }

  function handleRemoveRating(label: string) {
    const confirmed = window.confirm(
      `Remove "${label}" from the rating scale? Songs already rated with it keep the label but it stops being offered.`,
    );
    if (confirmed) onRemoveRating(label);
  }

  return (
    <div className="screen settings">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back
      </button>

      <h1>Global settings</h1>
      <p className="modal-subtitle">
        These apply to every database.{canEdit ? '' : ' You have read-only access, so they can be viewed but not changed.'}
      </p>

      <section className="settings-section">
        <h2>Rating Scale</h2>
        <p className="modal-subtitle">
          Rating a song resets its staleness clock by this many days. Renaming a label updates every song already
          rated with it, in every database.
        </p>

        <div className="settings-rating-list">
          {ratingScale.map((entry) => (
            <div key={entry.label} className="settings-rating-row">
              <input
                className="settings-rating-label"
                defaultValue={entry.label}
                disabled={!canEdit}
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
                disabled={!canEdit}
                onBlur={(e) => {
                  const intervalDays = Number(e.target.value);
                  if (Number.isFinite(intervalDays) && intervalDays !== entry.intervalDays) {
                    onUpdateRating(entry.label, { label: entry.label, intervalDays });
                  }
                }}
              />
              <span className="settings-rating-unit">days</span>
              {canEdit && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => handleRemoveRating(entry.label)}
                  aria-label={`Remove ${entry.label}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
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
        )}
      </section>

      <section className="settings-section">
        <h2>Genre values</h2>
        <p className="modal-subtitle">
          The list of genres every database picks from. Renaming or deleting one updates it everywhere.
        </p>
        <p className="settings-genre-preview">{genreValues.length > 0 ? genreValues.join(' · ') : 'No genres yet.'}</p>
        {canEdit && (
          <button type="button" className="btn btn-ghost" onClick={() => setShowGenreValues(true)}>
            Manage genre values
          </button>
        )}
      </section>

      {showGenreValues && (
        <ManageValues
          category={genreCategory}
          songs={songs}
          onRename={onRenameGenre}
          onDelete={onDeleteGenre}
          onAdd={onAddGenre}
          onReorder={onReorderGenre}
          onClose={() => setShowGenreValues(false)}
        />
      )}
    </div>
  );
}
