import type { Category, RatingScaleEntry, Song } from '../types';
import { categoryValues } from '../lib/filtering';

interface MatrixProps {
  songs: Song[];
  categories: Category[];
  ratingScale: RatingScaleEntry[];
  onSetTag: (song: Song, categoryId: string, value: string) => void;
  onBack: () => void;
}

// Shows whatever Results currently has filtered/sorted — narrowing down
// there first (e.g. "Genre: untagged") is how you keep this to a workable
// size instead of always rendering the whole library at once.
export default function Matrix({ songs, categories, ratingScale, onSetTag, onBack }: MatrixProps) {
  const columns = categories
    .map((category) => ({
      category,
      values: categoryValues(songs, category.id, ratingScale, category.values),
    }))
    .filter((c) => c.values.length > 0);

  const totalValueColumns = columns.reduce((sum, c) => sum + c.values.length, 0);

  return (
    <div className="screen matrix">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back to results
      </button>

      <h2>Matrix</h2>
      <p className="modal-subtitle">
        {songs.length} song{songs.length === 1 ? '' : 's'} — tap a box to set that value, tap it again to clear it
        (where clearing is possible). Use Filters on Results first to narrow this down.
      </p>

      <div className="matrix-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th className="matrix-corner">Song</th>
              {columns.map(({ category, values }) => (
                <th key={category.id} colSpan={values.length} className="matrix-category-header">
                  {category.name}
                </th>
              ))}
            </tr>
            <tr>
              <th className="matrix-corner matrix-corner-sub" />
              {columns.map(({ category, values }) =>
                values.map((value) => (
                  <th key={`${category.id}:${value}`} className="matrix-value-header">
                    {value}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {songs.map((song) => (
              <tr key={song.id}>
                <th className="matrix-row-header" scope="row">
                  <span className="song-title">{song.title}</span>
                  <span className="song-artist">{song.artist}</span>
                </th>
                {columns.map(({ category, values }) =>
                  values.map((value) => (
                    <td key={`${category.id}:${value}`} className="matrix-cell">
                      <input
                        type="checkbox"
                        checked={song.tags[category.id] === value}
                        onChange={() => onSetTag(song, category.id, value)}
                        aria-label={`${song.title} — ${category.name}: ${value}`}
                      />
                    </td>
                  )),
                )}
              </tr>
            ))}
            {songs.length === 0 && (
              <tr>
                <td className="matrix-empty" colSpan={1 + totalValueColumns}>
                  No songs match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
