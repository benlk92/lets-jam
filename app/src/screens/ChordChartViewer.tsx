import { useEffect, useRef, useState } from 'react';
import type { Song } from '../types';
import { transposeChordChart } from '../lib/chordChart';

interface ChordChartViewerProps {
  song: Song;
  loadAudioUrl: (path: string) => Promise<string>;
  onBack: () => void;
}

type Speed = 'off' | 'slow' | 'medium' | 'fast';

// Pixels per second — tuned for reading pace, not proportional to anything.
const SPEED_PX_PER_SEC: Record<Exclude<Speed, 'off'>, number> = {
  slow: 15,
  medium: 35,
  fast: 65,
};

const TICK_MS = 50;

// Playback only — adding/renaming/removing recordings stays in the tag
// editor. Fetched on demand, same as the tag editor's list, rather than the
// moment this screen opens.
function RecordingPlayback({
  title,
  path,
  loadAudioUrl,
}: {
  title: string;
  path: string;
  loadAudioUrl: (path: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  async function handlePlay() {
    setLoading(true);
    setError(null);
    try {
      setUrl(await loadAudioUrl(path));
    } catch {
      setError("Couldn't load this recording.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="recording-row">
      <div className="recording-row-main">
        <span className="recording-title">{title}</span>
        {url ? (
          <audio className="audio-player" controls src={url} autoPlay />
        ) : (
          <button type="button" className="btn btn-ghost btn-small" disabled={loading} onClick={handlePlay}>
            {loading ? 'Loading…' : '▶ Play'}
          </button>
        )}
      </div>
      {error && <p className="passphrase-error">{error}</p>}
    </div>
  );
}

export default function ChordChartViewer({ song, loadAudioUrl, onBack }: ChordChartViewerProps) {
  const [semitones, setSemitones] = useState(0);
  const [speed, setSpeed] = useState<Speed>('off');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (speed === 'off') return;
    const pxPerTick = (SPEED_PX_PER_SEC[speed] * TICK_MS) / 1000;
    const id = setInterval(() => {
      bodyRef.current?.scrollBy(0, pxPerTick);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [speed]);

  const displayText = transposeChordChart(song.chordChart ?? '', semitones);

  return (
    <div className="screen chord-chart-viewer">
      <div className="chord-chart-toolbar">
        <button type="button" className="btn btn-ghost btn-small" onClick={onBack}>
          ← Back
        </button>
        <div className="chord-chart-heading">
          <span className="chord-chart-title">{song.title}</span>
          <span className="chord-chart-artist">{song.artist}</span>
        </div>
        <div className="chord-chart-transpose">
          <button
            type="button"
            className="icon-button"
            onClick={() => setSemitones((s) => s - 1)}
            aria-label="Transpose down a half step"
          >
            −
          </button>
          <span className="chord-chart-transpose-value">{semitones > 0 ? `+${semitones}` : semitones}</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setSemitones((s) => s + 1)}
            aria-label="Transpose up a half step"
          >
            +
          </button>
        </div>
      </div>

      <div className="chord-chart-speed">
        {(['off', 'slow', 'medium', 'fast'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`chord-chart-speed-btn ${speed === s ? 'chord-chart-speed-btn-active' : ''}`}
            onClick={() => setSpeed(s)}
          >
            {s === 'off' ? 'Stop' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {song.recordings.length > 0 && (
        <div className="chord-chart-recordings">
          {song.recordings.map((recording) => (
            <RecordingPlayback
              key={recording.id}
              title={recording.title}
              path={recording.path}
              loadAudioUrl={loadAudioUrl}
            />
          ))}
        </div>
      )}

      <div className="chord-chart-body" ref={bodyRef}>
        {song.chordChart ? (
          <pre className="chord-chart-text">{displayText}</pre>
        ) : (
          <p className="chip-group-empty">No lyrics saved for this song yet.</p>
        )}
      </div>
    </div>
  );
}
