interface ChordChartEditorProps {
  value: string;
  // Fires on every keystroke/paste — just tracks the draft.
  onChange: (value: string) => void;
  // Fires on blur, to persist the edit.
  onCommit: (value: string) => void;
}

export default function ChordChartEditor({ value, onChange, onCommit }: ChordChartEditorProps) {
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
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit(value)}
      />
    </div>
  );
}
