import { useEffect, useRef, useState } from 'react';
import type { SongRecording } from '../types';

interface RecordingRowProps {
  recording: SongRecording;
  loadAudioUrl: (path: string) => Promise<string>;
  onRename: (recordingId: string, title: string) => Promise<void>;
  onRemove: (recordingId: string) => Promise<void>;
}

// Playback is fetched on demand (not the moment this row mounts) — with no
// cap on how many recordings a song can have, eagerly downloading every one
// just to show the tag editor would be wasteful.
function RecordingRow({ recording, loadAudioUrl, onRename, onRemove }: RecordingRowProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  async function handlePlay() {
    setLoading(true);
    setError(null);
    try {
      setUrl(await loadAudioUrl(recording.path));
    } catch {
      setError("Couldn't load this recording.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove() {
    const confirmed = window.confirm(`Remove "${recording.title}"? This can't be undone.`);
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove(recording.id);
    } catch {
      setError("Couldn't remove this recording.");
      setBusy(false);
    }
  }

  return (
    <div className="recording-row">
      <div className="recording-row-main">
        {editing ? (
          <input
            autoFocus
            className="recording-title-input"
            defaultValue={recording.title}
            onBlur={(e) => {
              const title = e.target.value.trim();
              setEditing(false);
              if (title && title !== recording.title) onRename(recording.id, title);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        ) : (
          <button type="button" className="recording-title" onClick={() => setEditing(true)}>
            {recording.title}
          </button>
        )}

        {url ? (
          <audio className="audio-player" controls src={url} autoPlay />
        ) : (
          <button type="button" className="btn btn-ghost btn-small" disabled={loading} onClick={handlePlay}>
            {loading ? 'Loading…' : '▶ Play'}
          </button>
        )}

        <button
          type="button"
          className="icon-button"
          disabled={busy}
          onClick={handleRemove}
          aria-label={`Remove ${recording.title}`}
        >
          ×
        </button>
      </div>
      {error && <p className="passphrase-error">{error}</p>}
    </div>
  );
}

interface AudioAttachmentProps {
  recordings: SongRecording[];
  loadAudioUrl: (path: string) => Promise<string>;
  onAdd: (title: string, file: File) => Promise<void>;
  onRename: (recordingId: string, title: string) => Promise<void>;
  onRemove: (recordingId: string) => Promise<void>;
}

export default function AudioAttachment({ recordings, loadAudioUrl, onAdd, onRename, onRemove }: AudioAttachmentProps) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setAdding(true);
    setError(null);
    try {
      await onAdd(`Recording ${recordings.length + 1}`, file);
    } catch {
      setError("Couldn't upload that recording.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="audio-attachment">
      {recordings.map((recording) => (
        <RecordingRow
          key={recording.id}
          recording={recording}
          loadAudioUrl={loadAudioUrl}
          onRename={onRename}
          onRemove={onRemove}
        />
      ))}

      <div className="audio-attachment-actions">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={adding}
          onClick={() => fileInputRef.current?.click()}
        >
          {adding ? 'Uploading…' : '+ Add recording'}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) handleFile(file);
        }}
      />
      {error && <p className="passphrase-error">{error}</p>}
    </div>
  );
}
