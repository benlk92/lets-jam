// show_date is a plain calendar date ('YYYY-MM-DD'), not a moment in time —
// building the Date from its parts avoids the off-by-one-day a UTC parse of
// the bare string would give in timezones behind UTC.
export function formatShowDate(showDate: string): string {
  const [year, month, day] = showDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
