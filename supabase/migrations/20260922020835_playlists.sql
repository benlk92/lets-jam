-- Saved playlists — an extension of the ephemeral "queue" (which stays
-- exactly as it was, just a local scratch list) into named, persisted,
-- reorderable song lists with a per-song "who's leading it" assignment.
--
-- playlist_songs is a join table, not a plain array of song ids, because
-- leader and position are properties of a song's appearance in *this*
-- playlist, not of the song itself — the same song can appear in different
-- playlists with a different leader and a different position each time.
--
-- playlist_leaders is a single shared, global name list (not per-space —
-- leaders are people, not song content), managed the same way the rating
-- scale is: a small named list editable from Settings.

create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  space text not null,
  created_at timestamptz not null default now()
);

create table if not exists playlist_songs (
  playlist_id uuid not null references playlists (id) on delete cascade,
  song_id uuid not null references songs (id) on delete cascade,
  sort_order integer not null,
  leader text,
  primary key (playlist_id, song_id)
);

create index if not exists playlist_songs_playlist_idx on playlist_songs (playlist_id, sort_order);

create table if not exists playlist_leaders (
  name text primary key,
  sort_order integer not null
);

alter table playlists enable row level security;
alter table playlist_songs enable row level security;
alter table playlist_leaders enable row level security;

create policy "read access" on playlists for select using (app_key_can_read());
create policy "write access insert" on playlists for insert with check (app_key_can_write());
create policy "write access update" on playlists for update using (app_key_can_write()) with check (app_key_can_write());
create policy "write access delete" on playlists for delete using (app_key_can_write());

create policy "read access" on playlist_songs for select using (app_key_can_read());
create policy "write access insert" on playlist_songs for insert with check (app_key_can_write());
create policy "write access update" on playlist_songs for update using (app_key_can_write()) with check (app_key_can_write());
create policy "write access delete" on playlist_songs for delete using (app_key_can_write());

create policy "read access" on playlist_leaders for select using (app_key_can_read());
create policy "write access insert" on playlist_leaders for insert with check (app_key_can_write());
create policy "write access update" on playlist_leaders for update using (app_key_can_write()) with check (app_key_can_write());
create policy "write access delete" on playlist_leaders for delete using (app_key_can_write());
