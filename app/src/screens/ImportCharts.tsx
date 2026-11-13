import { useRef, useState } from 'react';
import type { DatabaseInfo } from '../types';
import {
  DuplicateSongError,
  addSongToDatabase,
  createSongWithChart,
  fetchChartPresence,
  fillEmptyChart,
  findSongMatches,
  type SongMatch,
} from '../data/store';
import { parseChartFile } from '../lib/chartFile';

interface ImportChartsProps {
  database: DatabaseInfo;
  onBack: () => void;
  // Called after anything was imported, so the song list can reload.
  onImported: () => Promise<void>;
}

const NEW = 'new';

// A "looks similar" candidate that is almost certainly the very same song.
// A same-title-different-artist hit is not, so those default to a new song.
const SAME_SONG_REASONS = ['Very similar title and artist', 'Title and artist look swapped'];

interface Row {
  id: number;
  fileName: string;
  title: string;
  artist: string;
  chart: string;
  // Same title and artist as an earlier file in this batch.
  batchDuplicate: boolean;
  unreadable: boolean;
  exact: SongMatch | null;
  similar: SongMatch[];
  // NEW, or the sharedSongId of the similar song to use instead.
  choice: string;
  include: boolean;
  result: { ok: boolean; message: string } | null;
}

type Action =
  | { kind: 'skip'; label: string }
  | { kind: 'fill'; target: SongMatch; label: string }
  | { kind: 'new'; label: string };

function nameKey(title: string, artist: string): string {
  return `${title}|${artist}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');
}

export default function ImportCharts({ database, onBack, onImported }: ImportChartsProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  // Shared songs that already have a chart.
  const [hasChart, setHasChart] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [finished, setFinished] = useState(false);

  function actionFor(row: Row): Action {
    if (row.unreadable) return { kind: 'skip', label: "Couldn't read a title and artist" };
    if (row.batchDuplicate) return { kind: 'skip', label: 'Same song as an earlier file' };
    const target = row.exact ?? row.similar.find((m) => m.sharedSongId === row.choice) ?? null;
    if (target) {
      if (hasChart.has(target.sharedSongId)) return { kind: 'skip', label: 'Already has a chart' };
      return {
        kind: 'fill',
        target,
        label: target.inDatabase ? 'Add chart to existing song' : `Add chart, and add the song to ${database.name}`,
      };
    }
    return { kind: 'new', label: 'New song' };
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setReading(true);
    setReadError(null);
    setFinished(false);
    try {
      const next: Row[] = [];
      const seen = new Set<string>();
      let id = 0;
      for (const file of Array.from(files)) {
        const parsed = parseChartFile(await file.text());
        if (!parsed) {
          next.push({
            id: id++, fileName: file.name, title: '', artist: '', chart: '', batchDuplicate: false,
            unreadable: true, exact: null, similar: [], choice: NEW, include: false, result: null,
          });
          continue;
        }
        const key = nameKey(parsed.title, parsed.artist);
        const batchDuplicate = seen.has(key);
        seen.add(key);
        const matches = batchDuplicate
          ? { exact: [], similar: [] }
          : await findSongMatches(parsed.title, parsed.artist, '');
        const exact = matches.exact[0] ?? null;
        const likely = exact ? undefined : matches.similar.find((m) => SAME_SONG_REASONS.includes(m.reason));
        next.push({
          id: id++, fileName: file.name, ...parsed, batchDuplicate, unreadable: false,
          exact, similar: matches.similar, choice: likely?.sharedSongId ?? NEW, include: true, result: null,
        });
      }
      const ids = Array.from(
        new Set(next.flatMap((r) => [...(r.exact ? [r.exact.sharedSongId] : []), ...r.similar.map((m) => m.sharedSongId)])),
      );
      setHasChart(await fetchChartPresence(ids));
      setRows(next);
    } catch {
      setReadError("Couldn't check the library — check your connection and try again.");
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function update(id: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const todo = rows.filter((r) => r.include && !r.result && actionFor(r).kind !== 'skip');

  async function runImport() {
    setImporting(true);
    for (const row of todo) {
      const action = actionFor(row);
      try {
        if (action.kind === 'fill') {
          if (!action.target.inDatabase) await addSongToDatabase(database.id, action.target.sharedSongId);
          const filled = await fillEmptyChart(action.target.sharedSongId, row.chart);
          update(row.id, {
            result: { ok: true, message: filled ? 'Chart added' : 'Song added — it already had a chart' },
          });
        } else if (action.kind === 'new') {
          await createSongWithChart(row.title.trim(), row.artist.trim(), row.chart, row.similar.length > 0);
          update(row.id, { result: { ok: true, message: 'Song created' } });
        }
      } catch (err) {
        const message =
          err instanceof DuplicateSongError
            ? `Looks like ${err.matches[0]?.title ?? 'an existing song'} — not created`
            : 'Failed — check your connection and try again';
        update(row.id, { result: { ok: false, message } });
      }
    }
    await onImported();
    setImporting(false);
    setFinished(true);
  }

  const counts = {
    create: todo.filter((r) => actionFor(r).kind === 'new').length,
    fill: todo.filter((r) => actionFor(r).kind === 'fill').length,
  };
  const doneCount = rows.filter((r) => r.result?.ok).length;

  return (
    <div className="screen import-charts">
      <button type="button" className="btn btn-ghost" onClick={onBack} disabled={importing}>
        ← Back
      </button>

      <h2>Import charts</h2>
      <p className="modal-subtitle">
        Choose the Ultimate Guitar .txt files (select as many as you like). Charts for songs already in the library are
        added to them; anything else becomes a new song in {database.name}.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept=".txt,text/plain"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => fileInput.current?.click()}
        disabled={reading || importing}
      >
        {reading ? 'Reading…' : rows.length ? 'Choose different files' : 'Choose files'}
      </button>
      {readError && <p className="passphrase-error">{readError}</p>}

      {rows.length > 0 && (
        <>
          <ul className="match-list">
            {rows.map((row) => {
              const action = actionFor(row);
              const canEditName = action.kind === 'new' && !row.result;
              return (
                <li key={row.id} className="import-row">
                  <div className="import-row-main">
                    <input
                      type="checkbox"
                      checked={row.include && action.kind !== 'skip'}
                      disabled={action.kind === 'skip' || !!row.result || importing}
                      onChange={(e) => update(row.id, { include: e.target.checked })}
                      aria-label={`Import ${row.title || row.fileName}`}
                    />
                    <div className="import-row-info">
                      {canEditName ? (
                        <>
                          <input
                            className="value-row-input"
                            value={row.title}
                            onChange={(e) => update(row.id, { title: e.target.value })}
                            disabled={importing}
                            aria-label="Title"
                          />
                          <input
                            className="value-row-input"
                            value={row.artist}
                            onChange={(e) => update(row.id, { artist: e.target.value })}
                            disabled={importing}
                            aria-label="Artist"
                          />
                        </>
                      ) : (
                        <>
                          <span className="song-title">{row.title || row.fileName}</span>
                          {row.artist && <span className="song-artist">{row.artist}</span>}
                        </>
                      )}
                      <span className={`import-status${row.result && !row.result.ok ? ' import-status-error' : ''}`}>
                        {row.result ? (row.result.ok ? `✓ ${row.result.message}` : row.result.message) : action.label}
                        {row.exact && !row.result && action.kind !== 'new' && ` (${row.exact.title} — ${row.exact.artist})`}
                      </span>
                      {!row.exact && row.similar.length > 0 && !row.result && !importing && (
                        <select
                          className="import-choice"
                          value={row.choice}
                          onChange={(e) => update(row.id, { choice: e.target.value })}
                          aria-label="Similar songs"
                        >
                          <option value={NEW}>Create a new song</option>
                          {row.similar.map((m) => (
                            <option key={m.sharedSongId} value={m.sharedSongId}>
                              Use existing: {m.title} — {m.artist} ({m.reason})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {finished ? (
            <p className="modal-subtitle">
              Done — {doneCount} imported. Anything marked in red wasn't added.
            </p>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={runImport}
              disabled={importing || todo.length === 0}
            >
              {importing
                ? 'Importing…'
                : todo.length === 0
                  ? 'Nothing to import'
                  : `Import ${[
                      counts.create && `${counts.create} new song${counts.create === 1 ? '' : 's'}`,
                      counts.fill && `${counts.fill} chart${counts.fill === 1 ? '' : 's'}`,
                    ]
                      .filter(Boolean)
                      .join(' + ')}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
