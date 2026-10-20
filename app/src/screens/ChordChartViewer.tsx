import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '../types';
import { chordLineToNumbers, detectKey, KEY_NAMES, transposeChordChart, wrapChordChart } from '../lib/chordChart';

interface ChordChartViewerProps {
  song: Song;
  loadAudioUrl: (path: string) => Promise<string>;
  onBack: () => void;
}

type Speed = 'off' | 'slow' | 'medium' | 'fast';

// Pixels per second — tuned for reading pace, not proportional to anything.
const SPEED_PX_PER_SEC: Record<Exclude<Speed, 'off'>, number> = {
  slow: 9,
  medium: 18,
  fast: 35,
};

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
  const [showNumbers, setShowNumbers] = useState(false);
  const [keyOverride, setKeyOverride] = useState<number | null>(null);
  const [speed, setSpeed] = useState<Speed>('off');
  const [cols, setCols] = useState(0);
  const screenRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);

  // Position is tracked as a decimal and driven by real elapsed time:
  // browsers round a scroll offset to whole (device) pixels, so nudging by a
  // fraction each tick — which is all a slow speed amounts to — moved
  // nothing at all on a phone.
  useEffect(() => {
    if (speed === 'off') return;
    const el = bodyRef.current;
    if (!el) return;
    const pxPerSec = SPEED_PX_PER_SEC[speed];
    let position = el.scrollTop;
    let last = performance.now();
    let frame = 0;
    function step(now: number) {
      const elapsed = Math.min(now - last, 100);
      last = now;
      // A finger drag moves scrollTop underneath us — carry on from there.
      if (Math.abs(el!.scrollTop - position) > 1.5) position = el!.scrollTop;
      position += (pxPerSec * elapsed) / 1000;
      el!.scrollTop = position;
      frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [speed]);

  // The page itself must never move while playing: lock the document, and
  // route any drag that starts outside the lyrics (toolbar, gaps) into them.
  useEffect(() => {
    const html = document.documentElement;
    const previous = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    const screen = screenRef.current;
    const body = bodyRef.current;
    let lastY = 0;
    function handleTouchStart(e: TouchEvent) {
      lastY = e.touches[0].clientY;
    }
    function handleTouchMove(e: TouchEvent) {
      if (!body || body.contains(e.target as Node)) return;
      e.preventDefault();
      const y = e.touches[0].clientY;
      body.scrollTop += lastY - y;
      lastY = y;
    }
    screen?.addEventListener('touchstart', handleTouchStart, { passive: true });
    screen?.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      html.style.overflow = previous.html;
      document.body.style.overflow = previous.body;
      screen?.removeEventListener('touchstart', handleTouchStart);
      screen?.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  // How many monospace characters fit across the lyrics, so the chart can be
  // wrapped to the screen instead of scrolled sideways.
  const hasChart = Boolean(song.chordChart);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const probe = probeRef.current;
    if (!body || !probe) return;
    function measure() {
      const charWidth = probe!.getBoundingClientRect().width / 20;
      const style = getComputedStyle(body!);
      const inner = body!.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (charWidth > 0) setCols(Math.floor(inner / charWidth) - 1);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [hasChart]);

  const chart = song.chordChart ?? '';
  const detectedKey = useMemo(() => detectKey(chart), [chart]);
  const tonic = keyOverride ?? detectedKey ?? KEY_NAMES.indexOf('C');

  // Numbers are relative to the key, so transposing has no effect on them —
  // they're always built from the original chart, and the transpose control
  // gives way to a key picker while they're showing.
  const displayText = useMemo(
    () =>
      showNumbers
        ? wrapChordChart(chart, cols, (line) => chordLineToNumbers(line, tonic))
        : wrapChordChart(transposeChordChart(chart, semitones), cols),
    [chart, cols, showNumbers, tonic, semitones],
  );

  return (
    <div className="screen chord-chart-viewer" ref={screenRef}>
      <div className="chord-chart-toolbar">
        <button type="button" className="btn btn-ghost btn-small" onClick={onBack}>
          ← Back
        </button>
        <div className="chord-chart-heading">
          <span className="chord-chart-title">{song.title}</span>
          <span className="chord-chart-artist">{song.artist}</span>
        </div>
        {showNumbers ? (
          <label className="chord-chart-key">
            Key
            <select value={tonic} onChange={(e) => setKeyOverride(Number(e.target.value))}>
              {KEY_NAMES.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : (
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
        )}
      </div>

      {song.chordChart && (
        <div className="chord-chart-speed">
          <button
            type="button"
            className={`chord-chart-speed-btn ${!showNumbers ? 'chord-chart-speed-btn-active' : ''}`}
            onClick={() => setShowNumbers(false)}
          >
            Chord names
          </button>
          <button
            type="button"
            className={`chord-chart-speed-btn ${showNumbers ? 'chord-chart-speed-btn-active' : ''}`}
            onClick={() => setShowNumbers(true)}
          >
            Numbers
          </button>
        </div>
      )}

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
          <>
            <span className="chord-chart-probe" ref={probeRef} aria-hidden="true">
              MMMMMMMMMMMMMMMMMMMM
            </span>
            <pre className="chord-chart-text">{displayText}</pre>
          </>
        ) : (
          <p className="chip-group-empty">No lyrics saved for this song yet.</p>
        )}
      </div>
    </div>
  );
}
