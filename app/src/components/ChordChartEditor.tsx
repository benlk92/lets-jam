import { useRef, useState } from 'react';

interface ChordChartEditorProps {
  value: string;
  // Fires on every keystroke/paste — just tracks the draft.
  onChange: (value: string) => void;
  // Fires on blur (manual edits) and immediately after a successful PDF
  // import (a one-shot action, not something to wait on a blur for).
  onCommit: (value: string) => void;
}

export default function ChordChartEditor({ value, onChange, onCommit }: ChordChartEditorProps) {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (value.trim()) {
      const confirmed = window.confirm("Replace the current chord chart text with this PDF's content?");
      if (!confirmed) return;
    }
    setImporting(true);
    setImportError(null);
    try {
      // Lazy-loaded — pdf.js is a few hundred KB nobody should pay for
      // unless they actually import a PDF.
      const { extractChordChartFromPdf } = await import('../lib/pdfImport');
      const text = await extractChordChartFromPdf(file);
      onChange(text);
      onCommit(text);
    } catch (err) {
      if (err instanceof Error && err.message === 'NO_TEXT_LAYER') {
        setImportError(
          "This PDF has no selectable text — Ultimate Guitar's export renders the page as a picture, " +
            'not real text. Open the PDF and select the text with Live Text (press and hold on iPad, ' +
            'or select and copy on Mac), then paste it below instead.',
        );
      } else {
        setImportError("Couldn't read that PDF — try pasting the chart text instead.");
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="chord-chart-editor">
      <button
        type="button"
        className="btn btn-ghost btn-small"
        disabled={importing}
        onClick={() => fileInputRef.current?.click()}
      >
        {importing ? 'Importing…' : 'Import PDF'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) handleFile(file);
        }}
      />
      {importError && <p className="passphrase-error">{importError}</p>}
      <textarea
        className="chord-chart-textarea"
        value={value}
        placeholder={
          'Paste chord chart / lyrics here (e.g. select the text in a PDF with Live Text and paste it in), ' +
          'or try Import PDF above for PDFs with real text…\n\nA\nTwenty-five years and my life is still'
        }
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit(value)}
      />
    </div>
  );
}
