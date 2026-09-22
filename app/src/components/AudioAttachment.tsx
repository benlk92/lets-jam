import { useEffect, useRef, useState } from 'react';

interface AudioAttachmentProps {
  audioPath: string | null;
  loadAudioUrl: (path: string) => Promise<string>;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
}

export default function AudioAttachment({ audioPath, loadAudioUrl, onUpload, onRemove }: AudioAttachmentProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Storage RLS means the recording can't just be a public URL — it's
  // fetched through an authenticated download and turned into a local
  // object URL, which has to be revoked when it's replaced or this unmounts.
  // The parent keys this component on audioPath, so a null->path (or
  // path->path) change remounts it with objectUrl back at its initial
  // null rather than needing a reset branch here.
  useEffect(() => {
    if (!audioPath) return;
    let cancelled = false;
    let url: string | null = null;
    loadAudioUrl(audioPath)
      .then((loaded) => {
        if (cancelled) return;
        url = loaded;
        setObjectUrl(loaded);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the recording.");
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [audioPath, loadAudioUrl]);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      await onUpload(file);
    } catch {
      setError("Couldn't upload that recording.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await onRemove();
    } catch {
      setError("Couldn't remove that recording.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="audio-attachment">
      {objectUrl && <audio className="audio-player" controls src={objectUrl} />}
      <div className="audio-attachment-actions">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? 'Working…' : audioPath ? 'Replace recording' : 'Add recording'}
        </button>
        {audioPath && (
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={handleRemove}>
            Remove
          </button>
        )}
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
