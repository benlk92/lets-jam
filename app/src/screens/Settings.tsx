import { useState } from 'react';
import type { Category, DatabaseInfo, Song } from '../types';
import { GENRE_CATEGORY_ID } from '../lib/filtering';
import ManageValues from './ManageValues';
import { DEFAULT_SCROLL_SPEEDS, MAX_SCROLL_SPEED, MIN_SCROLL_SPEED, type ScrollSpeeds } from '../lib/scrollSpeeds';

interface SettingsProps {
  database: DatabaseInfo;
  onSwitchDatabase: () => void;
  onOpenGlobalSettings: () => void;
  categories: Category[];
  songs: Song[];
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
  onOpenAddSong: () => void;
  scrollSpeeds: ScrollSpeeds;
  onChangeScrollSpeeds: (speeds: ScrollSpeeds) => void;
  leaders: string[];
  onAddLeader: (name: string) => Promise<boolean>;
  onRenameLeader: (oldName: string, newName: string) => void;
  onRemoveLeader: (name: string) => void;
  onReorderLeaders: (orderedNames: string[]) => void;
}

const SPEED_NAMES = ['slow', 'medium', 'fast'] as const;

// Keeps what's being typed locally so the field can be cleared and retyped;
// a value is only saved once it's a valid speed, and the field snaps back to
// the saved one when it loses focus.
function SpeedField({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="settings-speed-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={MIN_SCROLL_SPEED}
        max={MAX_SCROLL_SPEED}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = Number(e.target.value);
          if (e.target.value !== '' && parsed >= MIN_SCROLL_SPEED && parsed <= MAX_SCROLL_SPEED) onCommit(parsed);
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  );
}

export default function Settings({
  database,
  onSwitchDatabase,
  onOpenGlobalSettings,
  categories,
  songs,
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
  onOpenAddSong,
  scrollSpeeds,
  onChangeScrollSpeeds,
  leaders,
  onAddLeader,
  onRenameLeader,
  onRemoveLeader,
  onReorderLeaders,
}: SettingsProps) {
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [valuesModalCategoryId, setValuesModalCategoryId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingLeader, setEditingLeader] = useState<string | null>(null);
  const [newLeaderName, setNewLeaderName] = useState('');

  const valuesModalCategory = categories.find((c) => c.id === valuesModalCategoryId) ?? null;

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

  async function handleAddLeader() {
    const name = newLeaderName.trim();
    if (!name) return;
    if (leaders.some((l) => l.toLowerCase() === name.toLowerCase())) {
      window.alert(`"${name}" is already in the leaders list.`);
      return;
    }
    if (await onAddLeader(name)) setNewLeaderName('');
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

  function handleRetireCategory(category: Category) {
    const confirmed = window.confirm(
      `Retire "${category.name}"? It'll disappear from Guided Picker, Filters, and Sort. Songs keep whatever value they already had, but you won't be able to see or edit it anymore.`,
    );
    if (confirmed) onRetireCategory(category.id);
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
        <h2>{database.name}</h2>
        <p className="modal-subtitle">
          Tags, categories, ratings and playlists belong to this database. Song titles, artists, links, lyrics and
          genres are shared with every database.
        </p>
        <div className="settings-space-toggle">
          <button type="button" className="btn btn-ghost" onClick={onSwitchDatabase}>
            Switch database
          </button>
          <button type="button" className="btn btn-ghost" onClick={onOpenGlobalSettings}>
            Global settings
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Lyrics Auto-Scroll</h2>
        <p className="modal-subtitle">
          How fast the lyrics scroll on the Slow, Medium and Fast buttons, in pixels per second. Saved on this device.
        </p>
        <div className="settings-speed-grid">
          {SPEED_NAMES.map((name) => (
            <SpeedField
              key={name}
              label={name.charAt(0).toUpperCase() + name.slice(1)}
              value={scrollSpeeds[name]}
              onCommit={(value) => onChangeScrollSpeeds({ ...scrollSpeeds, [name]: value })}
            />
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => onChangeScrollSpeeds(DEFAULT_SCROLL_SPEEDS)}
        >
          Reset to defaults
        </button>
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
                      onClick={() =>
                        category.id === GENRE_CATEGORY_ID ? onOpenGlobalSettings() : setValuesModalCategoryId(category.id)
                      }
                    >
                      {category.id === GENRE_CATEGORY_ID ? 'Values (global)' : 'Values'}
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
        <h2>Playlist Leaders</h2>
        <p className="modal-subtitle">
          Belongs to this database. Shows up as the leader dropdown when assigning a leader to a song within a
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
