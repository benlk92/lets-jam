import type { RatingScaleEntry, Song, Space } from '../types';
import { buildUltimateGuitarSearchUrl } from '../lib/ultimateGuitar';

interface AssessmentProps {
  space: Space;
  song: Song;
  ratingScale: RatingScaleEntry[];
  onRate: (label: string) => void;
  onToggleMemorized: (memorized: boolean) => void;
  onSkip: () => void;
  onRetag: (song: Song) => void;
  onOpenChordChart: () => void;
  onBack: () => void;
  backLabel?: string;
}

export default function Assessment({
  space,
  song,
  ratingScale,
  onRate,
  onToggleMemorized,
  onSkip,
  onRetag,
  onOpenChordChart,
  onBack,
  backLabel = 'Back to results',
}: AssessmentProps) {
  const isPopSongs = space === 'pop_songs';
  return (
    <div className="screen assessment">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← {backLabel}
      </button>

      <h2>{song.title}</h2>
      <p className="modal-subtitle">{song.artist}</p>

      {(song.ultimateGuitarUrl || isPopSongs) && (
        <a
          className="btn btn-ghost"
          href={song.ultimateGuitarUrl || buildUltimateGuitarSearchUrl(song.title)}
          target="_blank"
          rel="noreferrer"
        >
          {song.ultimateGuitarUrl
            ? isPopSongs
              ? 'Open chords / lyrics ↗'
              : 'Open link ↗'
            : 'Search Ultimate Guitar ↗'}
        </a>
      )}

      {song.chordChart && (
        <button type="button" className="btn btn-ghost" onClick={onOpenChordChart}>
          View chord chart
        </button>
      )}

      <label className="memorized-toggle">
        <input type="checkbox" checked={song.memorized} onChange={(e) => onToggleMemorized(e.target.checked)} />
        Memorized
      </label>

      <p className="assessment-prompt">
        {song.memorized
          ? 'How well did you play it from memory? This sets your Memorization Confidence.'
          : 'How well did you play through it (reading along)? This sets your Performance Confidence.'}
      </p>

      <div className="rating-buttons">
        {ratingScale.map((r) => (
          <button key={r.label} type="button" className="btn btn-rating" onClick={() => onRate(r.label)}>
            {r.label}
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-ghost btn-skip" onClick={onSkip}>
        Didn't perform
      </button>

      {song.playCount > 0 && (
        <p className="assessment-meta">
          Played {song.playCount} time{song.playCount === 1 ? '' : 's'}
          {song.lastPlayedAt &&
            ` — last on ${new Date(song.lastPlayedAt).toLocaleDateString()}, rated ${song.lastRatingLabel}`}
        </p>
      )}

      <button type="button" className="btn btn-link" onClick={() => onRetag(song)}>
        Re-tag this song
      </button>
    </div>
  );
}
