import { useState, type FormEvent } from 'react';

interface PasswordDialogProps {
  title: string;
  subtitle?: string;
  placeholder: string;
  submitLabel?: string;
  // Resolves to an error message, or null once it worked (the caller closes the dialog).
  onSubmit: (value: string) => Promise<string | null>;
  onCancel: () => void;
}

// A small modal asking for one password or code — used for "Unlock to edit".
export default function PasswordDialog({
  title,
  subtitle,
  placeholder,
  submitLabel = 'Unlock',
  onSubmit,
  onCancel,
}: PasswordDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value || checking) return;
    setChecking(true);
    setError(null);
    const message = await onSubmit(value);
    setChecking(false);
    if (message) setError(message);
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </header>
        <form className="modal-body" onSubmit={handleSubmit}>
          {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          <input
            type="password"
            autoFocus
            className="passphrase-input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {error && <p className="passphrase-error">{error}</p>}
          <div className="db-unlock-actions">
            <button type="submit" className="btn btn-primary" disabled={checking || !value}>
              {checking ? 'Checking…' : submitLabel}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
