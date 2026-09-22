-- Two independent song libraries — "Pop Songs" (the existing Ultimate
-- Guitar-driven repertoire) and "Circle Songs" (oral-tradition songs
-- learned from other musicians, usually with some link but not necessarily
-- an Ultimate Guitar one) — sharing one app, one passphrase gate, and one
-- rating scale, but with category sets that never mix. Not a security
-- boundary (no RLS change), just a data partition the client always
-- filters/writes by.

alter table songs add column if not exists space text not null default 'pop_songs';
alter table categories add column if not exists space text not null default 'pop_songs';

-- category ids were only ever unique app-wide (e.g. 'genre'); now that a
-- second space can define its own category with the same id, uniqueness
-- has to be per-space instead.
alter table categories drop constraint if exists categories_pkey;
alter table categories add constraint categories_pkey primary key (id, space);

-- Circle Songs starts with only the three structural categories every song
-- needs regardless of space (their values are derived from
-- memorized/lastRatingLabel at read time, not stored) — everything else is
-- content the user builds fresh per space, on purpose.
insert into categories (id, name, type, computed, guided_picker_enabled, sort_order, space) values
  ('memorized', 'Memorized', 'single', true, true, 0, 'circle_songs'),
  ('performance_confidence', 'Performance Confidence', 'single', true, true, 1, 'circle_songs'),
  ('memorization_confidence', 'Memorization Confidence', 'single', true, true, 2, 'circle_songs')
on conflict (id, space) do nothing;
