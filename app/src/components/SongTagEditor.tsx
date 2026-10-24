import { useState } from 'react';
import type { Category, RatingScaleEntry, Song, TagValue } from '../types';
import { categoryValues, GENRE_CATEGORY_ID } from '../lib/filtering';
import CategoryValueEditor from './CategoryValueEditor';
import ChipGroup from './ChipGroup';
import ChordChartEditor from './ChordChartEditor';
import AudioAttachment from './AudioAttachment';
import { buildUltimateGuitarSearchUrl } from '../lib/ultimateGuitar';

interface SongTagEditorProps {
  ugSearchFallback: boolean;
  // Name of the database that created this song and can edit its shared fields.
  ownerName: string;
  song: Song;
  categories: Category[];
  allSongs: Song[];
  ratingScale: RatingScaleEntry[];
  onClose: () => void;
  onUpdateTag: (categoryId: string, value: TagValue | null) => void;
  onUpdateTitleArtist: (title: string, artist: string) => void;
  onUpdateUrl: (url: string) => void;
  onUpdateChordChart: (chordChart: string) => void;
  onUnlinkField: (field: 'lyrics' | 'genre') => void;
  onRelinkField: (field: 'lyrics' | 'genre') => void;
  onAddRecording: (title: string, file: File) => Promise<void>;
  onRenameRecording: (recordingId: string, title: string) => Promise<void>;
  onRemoveRecording: (recordingId: string) => Promise<void>;
  loadAudioUrl: (path: string) => Promise<string>;
  onToggleMemorized: (memorized: boolean) => void;
  onRate: (label: string) => void;
  onDelete: () => void;
  onClearNotApplicable: (categoryId: string) => void;
}

export default function SongTagEditor({
  ugSearchFallback,
  ownerName,
  song,
  categories,
  allSongs,
  ratingScale,
  onClose,
  onUpdateTag,
  onUpdateTitleArtist,
  onUpdateUrl,
  onUpdateChordChart,
  onUnlinkField,
  onRelinkField,
  onAddRecording,
  onRenameRecording,
  onRemoveRecording,
  loadAudioUrl,
  onToggleMemorized,
  onRate,
  onDelete,
  onClearNotApplicable,
}: SongTagEditorProps) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [url, setUrl] = useState(song.ultimateGuitarUrl);
  const [chordChart, setChordChart] = useState(song.chordChart ?? '');
  const isPopSongs = ugSearchFallback;

  function handleDelete() {
    const confirmed = window.confirm(
      `Remove "${song.title}" by ${song.artist} from this database? Its tags, ratings, and recordings here will be deleted. ` +
        `The song itself stays in the shared library for any other database that uses it.`,
    );
    if (confirmed) onDelete();
  }

  function commitTitleArtist() {
    const trimmedTitle = title.trim();
    const trimmedArtist = artist.trim();
    if (!trimmedTitle || !trimmedArtist) return;
    if (trimmedTitle === song.title && trimmedArtist === song.artist) return;
    onUpdateTitleArtist(trimmedTitle, trimmedArtist);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>{song.title}</h2>
            <p className="modal-subtitle">{song.artist}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="modal-body">
          <section className="tag-editor-row">
            <h3>Title</h3>
            <input
              className="url-input"
              value={title}
              readOnly={!song.isOwner}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitleArtist}
            />
          </section>

          <section className="tag-editor-row">
            <h3>Artist</h3>
            <input
              className="url-input"
              value={artist}
              readOnly={!song.isOwner}
              onChange={(e) => setArtist(e.target.value)}
              onBlur={commitTitleArtist}
            />
            {!song.isOwner && (
              <p className="modal-subtitle">
                Shared song created by {ownerName} — only that database can change its title, artist, or link.
              </p>
            )}
          </section>

          <section className="tag-editor-row">
            <h3>{isPopSongs ? 'Ultimate Guitar Link' : 'Song Link'}</h3>
            <div className="url-input-row">
              <input
                type="url"
                className="url-input"
                value={url}
                readOnly={!song.isOwner}
                placeholder={isPopSongs ? 'https://tabs.ultimate-guitar.com/…' : 'https://…'}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => {
                  if (url !== song.ultimateGuitarUrl) onUpdateUrl(url);
                }}
              />
              {(url.trim() || isPopSongs) && (
                <a
                  className="icon-button"
                  href={url.trim() || buildUltimateGuitarSearchUrl(song.title)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={
                    url.trim() ? (isPopSongs ? 'Open Ultimate Guitar tab' : 'Open link') : 'Search Ultimate Guitar'
                  }
                >
                  ↗
                </a>
              )}
            </div>
          </section>

          <section className="tag-editor-row">
            <h3>Chord Chart / Lyrics</h3>
            <ChordChartEditor
              value={chordChart}
              readOnly={!song.isOwner && !song.lyricsUnlinked}
              onChange={setChordChart}
              onCommit={(value) => {
                setChordChart(value);
                if (value !== (song.chordChart ?? '')) onUpdateChordChart(value);
              }}
            />
            {song.isOwner && (
              <p className="modal-subtitle">Shared with every database that uses this song.</p>
            )}
            {!song.isOwner && !song.lyricsUnlinked && (
              <>
                <p className="modal-subtitle">
                  Following the lyrics from {ownerName}. Unlink to keep your own version in this database.
                </p>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => onUnlinkField('lyrics')}>
                  Unlink lyrics
                </button>
              </>
            )}
            {!song.isOwner && song.lyricsUnlinked && (
              <>
                <p className="modal-subtitle">This database has its own copy of the lyrics.</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => {
                    if (window.confirm(`Go back to following the lyrics from ${ownerName}? Your version here will be discarded.`)) {
                      onRelinkField('lyrics');
                    }
                  }}
                >
                  Relink to shared lyrics
                </button>
              </>
            )}
          </section>

          <section className="tag-editor-row">
            <h3>Recordings</h3>
            <AudioAttachment
              recordings={song.recordings}
              loadAudioUrl={loadAudioUrl}
              onAdd={onAddRecording}
              onRename={onRenameRecording}
              onRemove={onRemoveRecording}
            />
          </section>

          <section className="tag-editor-row">
            <label className="memorized-toggle">
              <input
                type="checkbox"
                checked={song.memorized}
                onChange={(e) => onToggleMemorized(e.target.checked)}
              />
              Memorized
            </label>
          </section>

          <section className="tag-editor-row">
            <h3>{song.memorized ? 'Memorization Confidence' : 'Performance Confidence'}</h3>
            <ChipGroup
              options={ratingScale.map((r) => r.label)}
              selected={song.lastRatingLabel ? [song.lastRatingLabel] : []}
              singleSelect
              onChange={(values) => {
                if (values[0]) onRate(values[0]);
              }}
            />
            {song.lastPlayedAt && (
              <p className="modal-subtitle">Last played {new Date(song.lastPlayedAt).toLocaleDateString()}</p>
            )}
          </section>

          {categories
            .filter((category) => !category.computed)
            .map((category) => (
              <section key={category.id} className="tag-editor-row">
                <h3>{category.name}</h3>
                {song.notApplicableCategories.includes(category.id) && (
                  <p className="modal-subtitle">
                    Marked as not applicable to this song —{' '}
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => onClearNotApplicable(category.id)}
                    >
                      undo
                    </button>
                  </p>
                )}
                <CategoryValueEditor
                  options={categoryValues(allSongs, category.id, undefined, category.values)}
                  value={song.tags[category.id]}
                  onChange={(value) => onUpdateTag(category.id, value)}
                  onAddValue={() => {}}
                />
                {category.id === GENRE_CATEGORY_ID && !song.isOwner && !song.genreUnlinked && (
                  <p className="modal-subtitle">
                    Following the genre set by {ownerName}. Changing it here gives this database its own.
                  </p>
                )}
                {category.id === GENRE_CATEGORY_ID && !song.isOwner && song.genreUnlinked && (
                  <p className="modal-subtitle">
                    This database has its own genre for the song.{' '}
                    <button type="button" className="inline-link" onClick={() => onRelinkField('genre')}>
                      Relink to the shared genre
                    </button>
                  </p>
                )}
              </section>
            ))}

          <section className="tag-editor-row">
            <button type="button" className="btn btn-danger" onClick={handleDelete}>
              Remove from this database
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
