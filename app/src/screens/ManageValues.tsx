import { useState } from 'react';
import type { Category, Song } from '../types';
import { categoryValues } from '../lib/filtering';

interface ManageValuesProps {
  category: Category;
  songs: Song[];
  onRename: (oldValue: string, newValue: string) => void;
  onDelete: (value: string) => void;
  onAdd: (value: string) => void;
  onReorder: (orderedValues: string[]) => void;
  // Only for per-database categories: the Guided Picker's "Skip" button text.
  onChangeSkipLabel?: (label: string) => void;
  onClose: () => void;
}

function songsWithValue(songs: Song[], categoryId: string, value: string): number {
  return songs.filter((song) => song.tags[categoryId] === value).length;
}

export default function ManageValues({ category, songs, onRename, onDelete, onAdd, onReorder, onChangeSkipLabel, onClose }: ManageValuesProps) {
  const values = categoryValues(songs, category.id, undefined, category.values);
  const [newValue, setNewValue] = useState('');

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  }

  function handleDelete(value: string) {
    const count = songsWithValue(songs, category.id, value);
    const confirmed = window.confirm(
      `Delete "${value}" from ${category.name}? It'll be removed from ${count} song${count === 1 ? '' : 's'} — this can't be undone.`,
    );
    if (confirmed) onDelete(value);
  }

  function handleAdd() {
    const trimmed = newValue.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onAdd(trimmed);
    setNewValue('');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{category.name} values</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal-body">
          {values.length === 0 && (
            <p className="modal-subtitle">No values yet — add one below, or tag a song with a new value.</p>
          )}
          {values.length > 1 && (
            <p className="modal-subtitle">Reorder with the arrows to control how these show up everywhere.</p>
          )}
          {values.map((value, index) => (
            <ValueRow
              key={value}
              value={value}
              index={index}
              total={values.length}
              onRename={onRename}
              onDelete={handleDelete}
              onMove={move}
            />
          ))}
          {onChangeSkipLabel && (
            <SkipRow key={category.skipLabel ?? ''} label={category.skipLabel ?? 'Skip'} onChange={onChangeSkipLabel} />
          )}
          <div className="settings-add-row">
            <input
              className="settings-add-name"
              placeholder="New value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
            />
            <button type="button" className="btn btn-primary" onClick={handleAdd}>
              Add
            </button>
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function ValueRow({
  value,
  index,
  total,
  onRename,
  onDelete,
  onMove,
}: {
  value: string;
  index: number;
  total: number;
  onRename: (oldValue: string, newValue: string) => void;
  onDelete: (value: string) => void;
  onMove: (index: number, delta: number) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <div className="value-row">
      <div className="settings-reorder">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
          aria-label={`Move ${value} up`}
        >
          ↑
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          onClick={() => onMove(index, 1)}
          aria-label={`Move ${value} down`}
        >
          ↓
        </button>
      </div>
      <input
        className="value-row-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed && trimmed !== value) onRename(value, trimmed);
          else setDraft(value);
        }}
      />
      <button type="button" className="icon-button" onClick={() => onDelete(value)} aria-label={`Delete ${value}`}>
        ×
      </button>
    </div>
  );
}

// The Guided Picker's "Skip" option shown as the last entry of the list: it
// can be renamed but not removed or reordered (it always comes last).
function SkipRow({ label, onChange }: { label: string; onChange: (label: string) => void }) {
  const [draft, setDraft] = useState(label);

  return (
    <div className="value-row value-row-skip">
      <input
        className="value-row-input"
        value={draft}
        aria-label="Skip button text"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const trimmed = draft.trim() || 'Skip';
          setDraft(trimmed);
          if (trimmed !== label) onChange(trimmed);
        }}
      />
      <span className="value-row-note">Skip button</span>
    </div>
  );
}
