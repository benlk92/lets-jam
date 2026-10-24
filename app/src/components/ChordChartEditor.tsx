interface ChordChartEditorProps {
  value: string;
  // Fires on every keystroke/paste — just tracks the draft.
  onChange: (value: string) => void;
  // Fires on blur, to persist the edit.
  onCommit: (value: string) => void;
  // Shown but not editable — for lyrics that belong to another database.
  readOnly?: boolean;
}

export default function ChordChartEditor({ value, onChange, onCommit, readOnly = false }: ChordChartEditorProps) {
  return (
    <div className="chord-chart-editor">
      <textarea
        className="chord-chart-textarea"
        value={value}
        placeholder={
          "Paste the chord chart here — copy it straight from Ultimate Guitar's editor (not the PDF export) " +
          'so the spacing between chords and lyrics comes along…\n\nA\nTwenty-five years and my life is still'
        }
        spellCheck={false}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit(value)}
      />
    </div>
  );
}
