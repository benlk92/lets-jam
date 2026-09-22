import { useState } from 'react';
import type { Category, Song, Space, TagValue } from '../types';
import { categoryValues } from '../lib/filtering';
import { parseUltimateGuitarUrl } from '../lib/ultimateGuitar';
import CategoryValueEditor from '../components/CategoryValueEditor';
import ChordChartEditor from '../components/ChordChartEditor';

interface AddSongProps {
  space: Space;
  categories: Category[];
  songs: Song[];
  onSave: (input: {
    title: string;
    artist: string;
    ultimateGuitarUrl: string;
    chordChart: string;
    tags: Record<string, TagValue>;
  }) => void;
  onCancel: () => void;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export default function AddSong({ space, categories, songs, onSave, onCancel }: AddSongProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [url, setUrl] = useState('');
  const [chordChart, setChordChart] = useState('');
  const [tags, setTags] = useState<Record<string, TagValue>>({});

  const taggableCategories = categories.filter((c) => !c.computed);
  const isPopSongs = space === 'pop_songs';

  // Only fills in blanks — never overwrites a title/artist the user already
  // typed, so pasting the link first vs. last both work sensibly. Circle
  // Songs' links aren't necessarily Ultimate Guitar's, so this auto-fill
  // only makes sense for Pop Songs.
  function handleUrlChange(value: string) {
    setUrl(value);
    if (!isPopSongs) return;
    const parsed = parseUltimateGuitarUrl(value);
    if (!parsed) return;
    if (!title.trim()) setTitle(parsed.title);
    if (!artist.trim()) setArtist(parsed.artist);
  }

  function setTag(categoryId: string, value: TagValue | null) {
    setTags((prev) => {
      const next = { ...prev };
      if (value == null) delete next[categoryId];
      else next[categoryId] = value;
      return next;
    });
  }

  function handleSave() {
    const trimmedTitle = title.trim();
    const trimmedArtist = artist.trim();
    if (!trimmedTitle || !trimmedArtist) return;

    const duplicate = songs.find(
      (s) => normalize(s.title) === normalize(trimmedTitle) && normalize(s.artist) === normalize(trimmedArtist),
    );
    if (duplicate) {
      const confirmed = window.confirm(
        `"${duplicate.title}" by ${duplicate.artist} is already in the library. Add this as a separate song anyway?`,
      );
      if (!confirmed) return;
    }

    onSave({ title: trimmedTitle, artist: trimmedArtist, ultimateGuitarUrl: url.trim(), chordChart, tags });
  }

  return (
    <div className="screen add-song">
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        ← Back to settings
      </button>

      <h2>Add Song</h2>

      <section className="tag-editor-row">
        <h3>{isPopSongs ? 'Ultimate Guitar Link' : 'Song Link'}</h3>
        <input
          type="url"
          className="url-input"
          value={url}
          placeholder={isPopSongs ? 'https://tabs.ultimate-guitar.com/…' : 'https://…'}
          onChange={(e) => handleUrlChange(e.target.value)}
        />
        {isPopSongs && (
          <p className="modal-subtitle">Pasting a link fills in the title and artist below, if they're blank.</p>
        )}
      </section>

      <section className="tag-editor-row">
        <h3>Chord Chart / Lyrics</h3>
        <ChordChartEditor value={chordChart} onChange={setChordChart} onCommit={setChordChart} />
      </section>

      <section className="tag-editor-row">
        <h3>Title</h3>
        <input
          className="url-input"
          value={title}
          placeholder="Song title"
          onChange={(e) => setTitle(e.target.value)}
        />
      </section>

      <section className="tag-editor-row">
        <h3>Artist</h3>
        <input
          className="url-input"
          value={artist}
          placeholder="Artist"
          onChange={(e) => setArtist(e.target.value)}
        />
      </section>

      {taggableCategories.map((category) => (
        <section key={category.id} className="tag-editor-row">
          <h3>{category.name}</h3>
          <CategoryValueEditor
            options={categoryValues(songs, category.id, undefined, category.values)}
            value={tags[category.id]}
            onChange={(value) => setTag(category.id, value)}
            onAddValue={() => {}}
          />
        </section>
      ))}

      <button
        type="button"
        className="btn btn-primary btn-large"
        disabled={!title.trim() || !artist.trim()}
        onClick={handleSave}
      >
        Save Song
      </button>
    </div>
  );
}
