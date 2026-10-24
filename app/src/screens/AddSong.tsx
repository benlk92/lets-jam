import { useEffect, useState } from 'react';
import type { Category, DatabaseInfo, Song, TagValue } from '../types';
import { categoryValues } from '../lib/filtering';
import { parseUltimateGuitarUrl } from '../lib/ultimateGuitar';
import { DuplicateSongError, type LibrarySong, type SongMatch } from '../data/store';
import CategoryValueEditor from '../components/CategoryValueEditor';
import ChordChartEditor from '../components/ChordChartEditor';

interface NewSongInput {
  title: string;
  artist: string;
  ultimateGuitarUrl: string;
  chordChart: string;
  tags: Record<string, TagValue>;
}

interface AddSongProps {
  database: DatabaseInfo;
  categories: Category[];
  songs: Song[];
  backLabel: string;
  onCancel: () => void;
  onSearchLibrary: (query: string) => Promise<LibrarySong[]>;
  // Brings an existing library song into this database; resolves true if it worked.
  onAddExisting: (sharedSongId: string) => Promise<boolean>;
  onFindMatches: (title: string, artist: string, url: string) => Promise<{ exact: SongMatch[]; similar: SongMatch[] }>;
  // Creates a brand-new song. Rejects with DuplicateSongError when the library
  // already has something that looks like it; resolves once saved.
  onSave: (input: NewSongInput, confirmedDifferent: boolean) => Promise<void>;
}

function MatchList({
  matches,
  databaseName,
  addedIds,
  onUseExisting,
}: {
  matches: SongMatch[];
  databaseName: string;
  addedIds: Set<string>;
  onUseExisting: (match: SongMatch) => void;
}) {
  return (
    <ul className="match-list">
      {matches.map((match) => (
        <li key={match.sharedSongId} className="match-row">
          <div className="match-info">
            <span className="song-title">{match.title}</span>
            <span className="song-artist">{match.artist}</span>
            <span className="match-reason">{match.reason}</span>
          </div>
          {addedIds.has(match.sharedSongId) ? (
            <span className="match-status">Added ✓</span>
          ) : match.inDatabase ? (
            <span className="match-status">Already in {databaseName}</span>
          ) : (
            <button type="button" className="btn btn-primary btn-small" onClick={() => onUseExisting(match)}>
              Add this one
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function AddSong({
  database,
  categories,
  songs,
  backLabel,
  onCancel,
  onSearchLibrary,
  onAddExisting,
  onFindMatches,
  onSave,
}: AddSongProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [url, setUrl] = useState('');
  const [chordChart, setChordChart] = useState('');
  const [tags, setTags] = useState<Record<string, TagValue>>({});

  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryResults, setLibraryResults] = useState<LibrarySong[]>([]);
  const [searching, setSearching] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const [liveMatches, setLiveMatches] = useState<{ exact: SongMatch[]; similar: SongMatch[] }>({
    exact: [],
    similar: [],
  });
  const [duplicate, setDuplicate] = useState<DuplicateSongError | null>(null);
  const [saving, setSaving] = useState(false);

  const taggableCategories = categories.filter((c) => !c.computed);
  const isPopSongs = database.ugSearchFallback;

  // Search the shared library as the user types, so a song that already
  // exists gets added rather than created again.
  useEffect(() => {
    const query = libraryQuery.trim();
    if (query.length < 2) {
      setLibraryResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      onSearchLibrary(query)
        .then(setLibraryResults)
        .catch(() => setLibraryResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryQuery]);

  // Warn about look-alikes while the new song is still being typed, not only
  // at save time.
  useEffect(() => {
    if (title.trim().length < 2 || artist.trim().length < 2) {
      setLiveMatches({ exact: [], similar: [] });
      return;
    }
    const handle = setTimeout(() => {
      onFindMatches(title, artist, url)
        .then(setLiveMatches)
        .catch(() => setLiveMatches({ exact: [], similar: [] }));
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, artist, url]);

  // Only fills in blanks — never overwrites a title/artist the user already
  // typed, so pasting the link first vs. last both work sensibly. Only
  // meaningful where links are Ultimate Guitar's.
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

  async function handleAddExisting(sharedSongId: string) {
    if (await onAddExisting(sharedSongId)) {
      setAddedIds((prev) => new Set(prev).add(sharedSongId));
      setDuplicate(null);
    }
  }

  async function save(confirmedDifferent: boolean) {
    const trimmedTitle = title.trim();
    const trimmedArtist = artist.trim();
    if (!trimmedTitle || !trimmedArtist || saving) return;
    setSaving(true);
    try {
      await onSave(
        { title: trimmedTitle, artist: trimmedArtist, ultimateGuitarUrl: url.trim(), chordChart, tags },
        confirmedDifferent,
      );
      setDuplicate(null);
    } catch (err) {
      if (err instanceof DuplicateSongError) setDuplicate(err);
      else throw err;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen add-song">
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        ← {backLabel}
      </button>

      <h2>Add Song</h2>
      <p className="modal-subtitle">
        Songs are shared between databases. Check the library first — if the song is already there, add it instead of
        creating it again.
      </p>

      <section className="tag-editor-row">
        <h3>Find it in the shared library</h3>
        <input
          className="url-input"
          type="search"
          value={libraryQuery}
          placeholder="Search by title or artist…"
          onChange={(e) => setLibraryQuery(e.target.value)}
        />
        {libraryQuery.trim().length >= 2 && (
          <ul className="match-list">
            {libraryResults.map((song) => {
              const here = song.inDatabase || addedIds.has(song.sharedSongId);
              return (
                <li key={song.sharedSongId} className="match-row">
                  <div className="match-info">
                    <span className="song-title">{song.title}</span>
                    <span className="song-artist">{song.artist}</span>
                  </div>
                  {here ? (
                    <span className="match-status">{addedIds.has(song.sharedSongId) ? 'Added ✓' : `Already in ${database.name}`}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={() => handleAddExisting(song.sharedSongId)}
                    >
                      Add
                    </button>
                  )}
                </li>
              );
            })}
            {!searching && libraryResults.length === 0 && (
              <li className="match-empty">Nothing in the library matches — create it below.</li>
            )}
          </ul>
        )}
      </section>

      <h3 className="add-song-divider">Or create a new song</h3>

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

      {liveMatches.exact.length > 0 && (
        <section className="match-callout match-callout-exact">
          <p>
            <strong>This song is already in the library.</strong> It can't be created twice — add the existing one:
          </p>
          <MatchList matches={liveMatches.exact} databaseName={database.name} addedIds={addedIds} onUseExisting={(m) => handleAddExisting(m.sharedSongId)} />
        </section>
      )}
      {liveMatches.exact.length === 0 && liveMatches.similar.length > 0 && (
        <section className="match-callout">
          <p>
            <strong>Heads up — this looks like something already in the library:</strong>
          </p>
          <MatchList matches={liveMatches.similar} databaseName={database.name} addedIds={addedIds} onUseExisting={(m) => handleAddExisting(m.sharedSongId)} />
        </section>
      )}

      <section className="tag-editor-row">
        <h3>Chord Chart / Lyrics</h3>
        <ChordChartEditor value={chordChart} onChange={setChordChart} onCommit={setChordChart} />
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
        disabled={!title.trim() || !artist.trim() || saving || liveMatches.exact.length > 0}
        onClick={() => save(false)}
      >
        {saving ? 'Saving…' : 'Save Song'}
      </button>

      {duplicate && (
        <div className="modal-backdrop" onClick={() => setDuplicate(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2>{duplicate.kind === 'exact' ? 'Already in the library' : 'Is this a duplicate?'}</h2>
              <button type="button" className="icon-button" onClick={() => setDuplicate(null)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="modal-body">
              <p className="modal-subtitle">
                {duplicate.kind === 'exact'
                  ? `"${title.trim()}" by ${artist.trim()} already exists, so it can't be created again. Add the existing song instead:`
                  : `"${title.trim()}" by ${artist.trim()} looks a lot like ${
                      duplicate.matches.length === 1 ? 'a song that already exists' : 'songs that already exist'
                    }. If it's the same song, add the existing one.`}
              </p>
              <MatchList
                matches={duplicate.matches}
                databaseName={database.name}
                addedIds={addedIds}
                onUseExisting={(m) => handleAddExisting(m.sharedSongId)}
              />
              {duplicate.kind === 'similar' && (
                <div className="match-confirm">
                  <p className="modal-subtitle">Only continue if you're sure this is a genuinely different song.</p>
                  <button type="button" className="btn btn-ghost" onClick={() => save(true)} disabled={saving}>
                    {saving ? 'Saving…' : "It's a different song — save it"}
                  </button>
                </div>
              )}
              <button type="button" className="btn btn-link" onClick={() => setDuplicate(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
