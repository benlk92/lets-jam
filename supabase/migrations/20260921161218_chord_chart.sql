-- Freeform chord chart / lyrics text per song, in the standard "chord line
-- directly above the lyric line it applies to" plain-text format (an
-- Ultimate Guitar chord-sheet export, imported or pasted). Nullable — most
-- songs won't have one until manually added.
alter table songs add column if not exists chord_chart text;
