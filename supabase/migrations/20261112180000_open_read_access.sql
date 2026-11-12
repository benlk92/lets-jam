-- Open read access. The app-wide passphrase (and its viewer twin) no longer
-- gates the multi-database tables:
--
--   * Anyone can READ every database, the shared song library, the global
--     settings and the audio recordings.
--   * WRITING inside a database needs that database's own password
--     (x-db-id + x-db-key, checked by active_db()), as before.
--   * Creating a database needs the "create database" code.
--   * Editing global settings (rating scale, genre values) needs the global
--     admin code, sent as the x-admin-key header.
--
-- The codes live hashed in access_codes. They are deliberately NOT in this
-- file: scripts/set-access-codes.mjs sets them, so they never reach git.
-- The legacy tables (songs, categories, ...) keep their old app-passphrase
-- policies untouched.

-- ── access codes ─────────────────────────────────────────────────────────
create table if not exists access_codes (
  kind text primary key check (kind in ('create_database', 'global_admin')),
  code_hash text not null
);
alter table access_codes enable row level security;
revoke all on access_codes from anon, authenticated;

-- Service-role only (the set-access-codes script); never callable from the app.
create or replace function set_access_code(p_kind text, p_code text) returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if coalesce(p_code, '') = '' then
    raise exception 'CODE_REQUIRED';
  end if;
  insert into access_codes (kind, code_hash) values (p_kind, crypt(p_code, gen_salt('bf')))
  on conflict (kind) do update set code_hash = excluded.code_hash;
end;
$$;
revoke all on function set_access_code(text, text) from public, anon, authenticated;

create or replace function access_code_valid(p_kind text, p_code text) returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from access_codes c
    where c.kind = p_kind and c.code_hash = crypt(coalesce(p_code, ''), c.code_hash)
  )
$$;
revoke all on function access_code_valid(text, text) from public, anon, authenticated;

-- The global admin code, sent with every request as x-admin-key.
create or replace function admin_key_valid() returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select access_code_valid('global_admin', coalesce(current_setting('request.headers', true)::json ->> 'x-admin-key', ''))
$$;
grant execute on function admin_key_valid() to anon, authenticated;

-- Lets the app check an admin code before remembering it.
create or replace function check_admin_code(p_code text) returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select access_code_valid('global_admin', p_code)
$$;
grant execute on function check_admin_code(text) to anon, authenticated;

-- ── reads are open ───────────────────────────────────────────────────────
drop policy if exists "list databases" on app_databases;
create policy "list databases" on app_databases for select using (true);

drop policy if exists "read shared" on shared_songs;
create policy "read shared" on shared_songs for select using (true);

drop policy if exists "read globals" on global_settings;
create policy "read globals" on global_settings for select using (true);

drop policy if exists "read access" on rating_scale;
create policy "read access" on rating_scale for select using (true);

-- ── writes: the database password (or the admin code for globals) ────────
drop policy if exists "owner insert" on shared_songs;
drop policy if exists "owner update" on shared_songs;
create policy "owner insert" on shared_songs for insert
  with check (owner_db = (select active_db()));
create policy "owner update" on shared_songs for update
  using (owner_db = (select active_db()))
  with check (owner_db = (select active_db()));

do $$
declare
  t text;
begin
  foreach t in array array['db_songs', 'db_categories', 'db_playlists', 'db_playlist_leaders'] loop
    execute format('drop policy if exists "read own db" on %I', t);
    execute format('drop policy if exists "write own db insert" on %I', t);
    execute format('drop policy if exists "write own db update" on %I', t);
    execute format('drop policy if exists "write own db delete" on %I', t);
    execute format('create policy "read own db" on %I for select using (true)', t);
    execute format('create policy "write own db insert" on %I for insert with check (db_id = (select active_db()))', t);
    execute format('create policy "write own db update" on %I for update using (db_id = (select active_db())) with check (db_id = (select active_db()))', t);
    execute format('create policy "write own db delete" on %I for delete using (db_id = (select active_db()))', t);
  end loop;
end $$;

drop policy if exists "read own db" on db_playlist_songs;
drop policy if exists "write own db insert" on db_playlist_songs;
drop policy if exists "write own db update" on db_playlist_songs;
drop policy if exists "write own db delete" on db_playlist_songs;
create policy "read own db" on db_playlist_songs for select using (true);
create policy "write own db insert" on db_playlist_songs for insert with check (
  exists (select 1 from db_playlists p where p.id = playlist_id and p.db_id = (select active_db())));
create policy "write own db update" on db_playlist_songs for update
  using (exists (select 1 from db_playlists p where p.id = playlist_id and p.db_id = (select active_db())))
  with check (exists (select 1 from db_playlists p where p.id = playlist_id and p.db_id = (select active_db())));
create policy "write own db delete" on db_playlist_songs for delete using (
  exists (select 1 from db_playlists p where p.id = playlist_id and p.db_id = (select active_db())));

drop policy if exists "write globals insert" on global_settings;
drop policy if exists "write globals update" on global_settings;
drop policy if exists "write globals delete" on global_settings;
create policy "write globals insert" on global_settings for insert with check ((select admin_key_valid()));
create policy "write globals update" on global_settings for update
  using ((select admin_key_valid())) with check ((select admin_key_valid()));
create policy "write globals delete" on global_settings for delete using ((select admin_key_valid()));

drop policy if exists "write access insert" on rating_scale;
drop policy if exists "write access update" on rating_scale;
drop policy if exists "write access delete" on rating_scale;
create policy "write access insert" on rating_scale for insert with check ((select admin_key_valid()));
create policy "write access update" on rating_scale for update
  using ((select admin_key_valid())) with check ((select admin_key_valid()));
create policy "write access delete" on rating_scale for delete using ((select admin_key_valid()));

-- ── recordings: anyone can listen; saving or deleting needs the password of
-- the database the song belongs to. Objects live at {db_songs.id}/{recording id}.
drop policy if exists "audio shared key access" on storage.objects;
drop policy if exists "audio read" on storage.objects;
drop policy if exists "audio write insert" on storage.objects;
drop policy if exists "audio write update" on storage.objects;
drop policy if exists "audio write delete" on storage.objects;
create policy "audio read" on storage.objects for select using (bucket_id = 'audio');
create policy "audio write insert" on storage.objects for insert with check (
  bucket_id = 'audio'
  and exists (select 1 from public.db_songs s
              where s.id::text = (storage.foldername(name))[1] and s.db_id = (select public.active_db())));
create policy "audio write update" on storage.objects for update
  using (bucket_id = 'audio'
         and exists (select 1 from public.db_songs s
                     where s.id::text = (storage.foldername(name))[1] and s.db_id = (select public.active_db())))
  with check (bucket_id = 'audio'
         and exists (select 1 from public.db_songs s
                     where s.id::text = (storage.foldername(name))[1] and s.db_id = (select public.active_db())));
create policy "audio write delete" on storage.objects for delete using (
  bucket_id = 'audio'
  and exists (select 1 from public.db_songs s
              where s.id::text = (storage.foldername(name))[1] and s.db_id = (select public.active_db())));

-- ── functions ────────────────────────────────────────────────────────────
-- unlock_database: just the database password now.
create or replace function unlock_database(p_db uuid, p_password text) returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from app_databases d
    where d.id = p_db and d.password_hash = crypt(coalesce(p_password, ''), d.password_hash)
  )
$$;
grant execute on function unlock_database(uuid, text) to anon, authenticated;

-- create_database: now takes the "create database" code.
drop function if exists create_database(text, text, boolean);
create or replace function create_database(p_name text, p_password text, p_create_code text, p_ug_search boolean default false)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if not access_code_valid('create_database', p_create_code) then
    raise exception 'NOT_ALLOWED';
  end if;
  if btrim(coalesce(p_name, '')) = '' or coalesce(p_password, '') = '' then
    raise exception 'NAME_AND_PASSWORD_REQUIRED';
  end if;
  if exists (select 1 from app_databases where lower(name) = lower(btrim(p_name))) then
    raise exception 'NAME_TAKEN';
  end if;

  insert into app_databases (name, password_hash, ug_search_fallback)
  values (btrim(p_name), crypt(p_password, gen_salt('bf')), coalesce(p_ug_search, false))
  returning id into v_id;

  insert into db_categories (id, db_id, name, type, computed, guided_picker_enabled, scatter_picker_enabled, sort_order)
  values
    ('memorized', v_id, 'Memorized', 'single', true, true, false, 0),
    ('performance_confidence', v_id, 'Performance Confidence', 'single', true, true, false, 1),
    ('memorization_confidence', v_id, 'Memorization Confidence', 'single', true, true, false, 2),
    ('genre_2', v_id, 'Genre', 'single', false, false, false, 3);

  return v_id;
end;
$$;
grant execute on function create_database(text, text, text, boolean) to anon, authenticated;

-- remove_db_song: the database password is the only check.
create or replace function remove_db_song(p_song_id uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  e db_songs;
  s shared_songs;
  n db_songs;
begin
  select * into e from db_songs where id = p_song_id;
  if e.id is null then
    raise exception 'SONG_NOT_FOUND';
  end if;
  if e.db_id is distinct from (select active_db()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into s from shared_songs where id = e.shared_song_id;
  delete from db_songs where id = e.id;

  select * into n from db_songs where shared_song_id = s.id order by created_at limit 1;
  if n.id is null then
    delete from shared_songs where id = s.id;
  elsif s.owner_db = e.db_id then
    update shared_songs
    set owner_db = n.db_id,
        chord_chart = case when n.lyrics_unlinked then n.chord_chart_override else chord_chart end,
        genre = case when n.genre_unlinked then n.genre_override else genre end
    where id = s.id;
    update db_songs
    set lyrics_unlinked = false, chord_chart_override = null, genre_unlinked = false, genre_override = null
    where id = n.id;
  end if;
end;
$$;
grant execute on function remove_db_song(uuid) to anon, authenticated;

-- Global edits that reach every database: the admin code.
create or replace function rename_rating_label(p_old text, p_new text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not (select admin_key_valid()) then
    raise exception 'NOT_ALLOWED';
  end if;
  update db_songs set last_rating_label = p_new where last_rating_label = p_old;
end;
$$;
grant execute on function rename_rating_label(text, text) to anon, authenticated;

create or replace function rename_genre_value(p_old text, p_new text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not (select admin_key_valid()) then
    raise exception 'NOT_ALLOWED';
  end if;
  update shared_songs set genre = p_new where genre = p_old;
  update db_songs set genre_override = p_new where genre_override = p_old;
  update global_settings
  set value = (
    select coalesce(jsonb_agg(case when v = p_old then p_new else v end order by o), '[]'::jsonb)
    from jsonb_array_elements_text(value) with ordinality as e(v, o)
  )
  where key = 'genre_values';
end;
$$;
grant execute on function rename_genre_value(text, text) to anon, authenticated;

create or replace function delete_genre_value(p_value text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not (select admin_key_valid()) then
    raise exception 'NOT_ALLOWED';
  end if;
  update shared_songs set genre = null where genre = p_value;
  update db_songs set genre_override = null where genre_override = p_value;
  update global_settings
  set value = (
    select coalesce(jsonb_agg(v order by o), '[]'::jsonb)
    from jsonb_array_elements_text(value) with ordinality as e(v, o)
    where v <> p_value
  )
  where key = 'genre_values';
end;
$$;
grant execute on function delete_genre_value(text) to anon, authenticated;
