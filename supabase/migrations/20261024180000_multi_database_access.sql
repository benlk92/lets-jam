-- Multi-database access rules and server functions. Still additive: the legacy
-- tables and their policies are untouched, so the current app keeps working.
--
-- A request is allowed to work inside a database only when it carries the app
-- password (x-app-key, as today) AND that database's own password
-- (x-db-id + x-db-key). The app password's role still decides read vs write:
-- the viewer password can read inside a database but never change anything.

alter table app_databases add column if not exists ug_search_fallback boolean not null default false;
update app_databases set ug_search_fallback = true where lower(name) = 'pop songs';

-- The database this request has unlocked, or null. One password check per
-- statement (it is called as a scalar subquery in every policy), not per row.
create or replace function active_db() returns uuid
language sql stable security definer
set search_path = public, extensions
as $$
  select d.id
  from app_databases d
  where d.id::text = coalesce(current_setting('request.headers', true)::json ->> 'x-db-id', '')
    and d.password_hash = crypt(coalesce(current_setting('request.headers', true)::json ->> 'x-db-key', ''), d.password_hash)
$$;
grant execute on function active_db() to anon, authenticated;

-- The picker lists names only; the hash is never selectable.
revoke all on app_databases from anon, authenticated;
grant select (id, name, ug_search_fallback, created_at) on app_databases to anon, authenticated;
drop policy if exists "list databases" on app_databases;
create policy "list databases" on app_databases for select using ((select app_key_can_read()));

-- ── shared songs: everyone with the app password can read; only the owning
-- database (unlocked, with an admin app key) can add or change them. No delete
-- policy — removal goes through remove_db_song().
drop policy if exists "read shared" on shared_songs;
drop policy if exists "owner insert" on shared_songs;
drop policy if exists "owner update" on shared_songs;
create policy "read shared" on shared_songs for select using ((select app_key_can_read()));
create policy "owner insert" on shared_songs for insert
  with check ((select app_key_can_write()) and owner_db = (select active_db()));
create policy "owner update" on shared_songs for update
  using ((select app_key_can_write()) and owner_db = (select active_db()))
  with check ((select app_key_can_write()) and owner_db = (select active_db()));

-- ── per-database tables: scoped to the unlocked database ──
do $$
declare
  t text;
begin
  foreach t in array array['db_songs', 'db_categories', 'db_playlists', 'db_playlist_leaders'] loop
    execute format('drop policy if exists "read own db" on %I', t);
    execute format('drop policy if exists "write own db insert" on %I', t);
    execute format('drop policy if exists "write own db update" on %I', t);
    execute format('drop policy if exists "write own db delete" on %I', t);
    execute format('create policy "read own db" on %I for select using ((select app_key_can_read()) and db_id = (select active_db()))', t);
    execute format('create policy "write own db insert" on %I for insert with check ((select app_key_can_write()) and db_id = (select active_db()))', t);
    execute format('create policy "write own db update" on %I for update using ((select app_key_can_write()) and db_id = (select active_db())) with check ((select app_key_can_write()) and db_id = (select active_db()))', t);
    execute format('create policy "write own db delete" on %I for delete using ((select app_key_can_write()) and db_id = (select active_db()))', t);
  end loop;
end $$;

drop policy if exists "read own db" on db_playlist_songs;
drop policy if exists "write own db insert" on db_playlist_songs;
drop policy if exists "write own db update" on db_playlist_songs;
drop policy if exists "write own db delete" on db_playlist_songs;
create policy "read own db" on db_playlist_songs for select using (
  (select app_key_can_read())
  and exists (select 1 from db_playlists p where p.id = playlist_id and p.db_id = (select active_db())));
create policy "write own db insert" on db_playlist_songs for insert with check (
  (select app_key_can_write())
  and exists (select 1 from db_playlists p where p.id = playlist_id and p.db_id = (select active_db())));
create policy "write own db update" on db_playlist_songs for update
  using ((select app_key_can_write()) and exists (select 1 from db_playlists p where p.id = playlist_id and p.db_id = (select active_db())))
  with check ((select app_key_can_write()) and exists (select 1 from db_playlists p where p.id = playlist_id and p.db_id = (select active_db())));
create policy "write own db delete" on db_playlist_songs for delete using (
  (select app_key_can_write())
  and exists (select 1 from db_playlists p where p.id = playlist_id and p.db_id = (select active_db())));

-- ── global settings: readable by all, changed only with the (admin) app password ──
drop policy if exists "read globals" on global_settings;
drop policy if exists "write globals insert" on global_settings;
drop policy if exists "write globals update" on global_settings;
drop policy if exists "write globals delete" on global_settings;
create policy "read globals" on global_settings for select using ((select app_key_can_read()));
create policy "write globals insert" on global_settings for insert with check ((select app_key_can_write()));
create policy "write globals update" on global_settings for update using ((select app_key_can_write())) with check ((select app_key_can_write()));
create policy "write globals delete" on global_settings for delete using ((select app_key_can_write()));

-- ── unlocking and creating databases ─────────────────────────────────────
create or replace function unlock_database(p_db uuid, p_password text) returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select (select app_key_can_read())
     and exists (
       select 1 from app_databases d
       where d.id = p_db and d.password_hash = crypt(coalesce(p_password, ''), d.password_hash)
     )
$$;
grant execute on function unlock_database(uuid, text) to anon, authenticated;

-- Needs the admin app password. Seeds the permanent categories every database
-- carries (their value lists come from the rating scale / global Genre list).
create or replace function create_database(p_name text, p_password text, p_ug_search boolean default false)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if not (select app_key_can_write()) then
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
grant execute on function create_database(text, text, boolean) to anon, authenticated;

-- ── a song as the app sees it: the entry plus its shared song ────────────
create or replace function song_json(e db_songs) returns jsonb
language sql stable
as $$
  select to_jsonb(e) || jsonb_build_object(
    'shared_songs', (select to_jsonb(s) from shared_songs s where s.id = e.shared_song_id)
  )
$$;

create or replace function rate_db_song(p_song_id uuid, p_rating_label text) returns jsonb
language plpgsql
as $$
declare
  v db_songs;
begin
  update db_songs
  set last_played_at = now(), last_rating_label = p_rating_label, play_count = play_count + 1
  where id = p_song_id
  returning * into v;
  if v.id is null then
    raise exception 'SONG_NOT_FOUND_OR_NOT_EDITABLE';
  end if;
  return song_json(v);
end;
$$;

-- Genre and lyrics live on the shared song, so a plain tag write isn't enough:
-- the owner writes the shared value; anyone else's edit lives only in their
-- own database (genre auto-unlinks; lyrics must be unlinked first).
create or replace function set_db_song_genre(p_song_id uuid, p_value text) returns jsonb
language plpgsql
as $$
declare
  e db_songs;
  s shared_songs;
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  select * into e from db_songs where id = p_song_id;
  if e.id is null then
    raise exception 'SONG_NOT_FOUND_OR_NOT_EDITABLE';
  end if;
  select * into s from shared_songs where id = e.shared_song_id;
  if s.owner_db = e.db_id then
    update shared_songs set genre = v where id = s.id;
  else
    update db_songs set genre_unlinked = true, genre_override = v where id = e.id;
  end if;
  if not found then
    raise exception 'SONG_NOT_FOUND_OR_NOT_EDITABLE';
  end if;
  select * into e from db_songs where id = p_song_id;
  return song_json(e);
end;
$$;

create or replace function set_db_song_lyrics(p_song_id uuid, p_text text) returns jsonb
language plpgsql
as $$
declare
  e db_songs;
  s shared_songs;
  v text := nullif(btrim(coalesce(p_text, '')), '');
begin
  select * into e from db_songs where id = p_song_id;
  if e.id is null then
    raise exception 'SONG_NOT_FOUND_OR_NOT_EDITABLE';
  end if;
  select * into s from shared_songs where id = e.shared_song_id;
  if s.owner_db = e.db_id then
    update shared_songs set chord_chart = v where id = s.id;
  elsif e.lyrics_unlinked then
    update db_songs set chord_chart_override = v where id = e.id;
  else
    raise exception 'LYRICS_LINKED';
  end if;
  if not found then
    raise exception 'SONG_NOT_FOUND_OR_NOT_EDITABLE';
  end if;
  select * into e from db_songs where id = p_song_id;
  return song_json(e);
end;
$$;

-- p_field is 'lyrics' or 'genre'. Unlinking starts from the current shared
-- value; relinking throws the local copy away. The owner has nothing to unlink.
create or replace function unlink_db_song_field(p_song_id uuid, p_field text) returns jsonb
language plpgsql
as $$
declare
  e db_songs;
  s shared_songs;
begin
  select * into e from db_songs where id = p_song_id;
  if e.id is null then
    raise exception 'SONG_NOT_FOUND_OR_NOT_EDITABLE';
  end if;
  select * into s from shared_songs where id = e.shared_song_id;
  if s.owner_db = e.db_id then
    raise exception 'OWNER_CANNOT_UNLINK';
  end if;
  if p_field = 'lyrics' then
    update db_songs set lyrics_unlinked = true, chord_chart_override = s.chord_chart where id = e.id;
  elsif p_field = 'genre' then
    update db_songs set genre_unlinked = true, genre_override = s.genre where id = e.id;
  else
    raise exception 'UNKNOWN_FIELD';
  end if;
  select * into e from db_songs where id = p_song_id;
  return song_json(e);
end;
$$;

create or replace function relink_db_song_field(p_song_id uuid, p_field text) returns jsonb
language plpgsql
as $$
declare
  e db_songs;
begin
  if p_field = 'lyrics' then
    update db_songs set lyrics_unlinked = false, chord_chart_override = null where id = p_song_id returning * into e;
  elsif p_field = 'genre' then
    update db_songs set genre_unlinked = false, genre_override = null where id = p_song_id returning * into e;
  else
    raise exception 'UNKNOWN_FIELD';
  end if;
  if e.id is null then
    raise exception 'SONG_NOT_FOUND_OR_NOT_EDITABLE';
  end if;
  return song_json(e);
end;
$$;

create or replace function update_db_song_tag(p_song_id uuid, p_category_id text, p_value jsonb) returns jsonb
language plpgsql
as $$
declare
  v db_songs;
begin
  if p_category_id = 'genre_2' then
    return set_db_song_genre(p_song_id, p_value #>> '{}');
  end if;
  update db_songs set tags = tags || jsonb_build_object(p_category_id, p_value) where id = p_song_id returning * into v;
  if v.id is null then
    raise exception 'SONG_NOT_FOUND_OR_NOT_EDITABLE';
  end if;
  return song_json(v);
end;
$$;

create or replace function delete_db_song_tag(p_song_id uuid, p_category_id text) returns jsonb
language plpgsql
as $$
declare
  v db_songs;
begin
  if p_category_id = 'genre_2' then
    return set_db_song_genre(p_song_id, null);
  end if;
  update db_songs set tags = tags - p_category_id where id = p_song_id returning * into v;
  if v.id is null then
    raise exception 'SONG_NOT_FOUND_OR_NOT_EDITABLE';
  end if;
  return song_json(v);
end;
$$;

-- ── duplicate detection ──────────────────────────────────────────────────
-- Same as text_key, but also ignores "(Live)", "[Acoustic]" and trailing
-- "- Remastered"-style notes — used only for the "does this sound like
-- something we already have?" check, never for the hard exact-match rule.
create or replace function song_loose_key(t text) returns text
language sql immutable parallel safe
set search_path = public, extensions
as $$
  select text_key(
    regexp_replace(
      regexp_replace(coalesce(t, ''), '\([^)]*\)|\[[^]]*\]', ' ', 'g'),
      '\s+-\s*(live|remaster(ed)?|acoustic|demo|radio edit|single version|album version|version|mono|stereo).*$',
      '', 'i'
    )
  )
$$;

-- Every shared song that could be what the user is about to add. 'exact'
-- (same title+artist, or same link) is a hard stop; 'similar' needs the user
-- to confirm it's genuinely a different song.
create or replace function find_song_matches(p_title text, p_artist text, p_url text default '')
returns table (
  shared_song_id uuid, title text, artist text, ultimate_guitar_url text,
  in_database boolean, tier text, reason text, score real
)
language sql stable
set search_path = public, extensions
as $$
  with q as (
    select text_key(p_title) as tk,
           text_key(p_artist) as ak,
           song_loose_key(p_title) as lt,
           link_key(p_url) as lkey
  ),
  scored as (
    select s.id, s.title, s.artist, s.ultimate_guitar_url,
           exists (
             select 1 from db_songs d
             where d.shared_song_id = s.id and d.db_id = (select active_db())
           ) as in_db,
           case
             when s.title_key = q.tk and s.artist_key = q.ak then 'exact'
             when q.lkey is not null and s.link_key = q.lkey then 'exact'
             else 'similar'
           end as tier,
           case
             when s.title_key = q.tk and s.artist_key = q.ak then 'Same title and artist'
             when q.lkey is not null and s.link_key = q.lkey then 'Same link'
             when s.title_key = q.tk then 'Same title, different artist'
             when s.title_key = q.ak and s.artist_key = q.tk then 'Title and artist look swapped'
             when song_loose_key(s.title) = q.lt
                  and (s.artist_key = q.ak or similarity(s.artist_key, q.ak) >= 0.4)
               then 'Same song apart from a note like "(Live)"'
             when similarity(s.title_key, q.tk) >= 0.55
                  and (s.artist_key = q.ak or similarity(s.artist_key, q.ak) >= 0.35)
               then 'Very similar title and artist'
             when s.artist_key = q.ak and similarity(s.title_key, q.tk) >= 0.4
               then 'Similar title by the same artist'
           end as reason,
           greatest(similarity(s.title_key, q.tk), similarity(s.artist_key, q.ak))::real as score
    from shared_songs s, q
  )
  select id, title, artist, ultimate_guitar_url, in_db, tier, reason, score
  from scored
  where reason is not null
  order by (tier = 'exact') desc, score desc
  limit 12
$$;
grant execute on function find_song_matches(text, text, text) to anon, authenticated;

-- Adds a brand-new song to the shared library AND to the unlocked database.
-- Raises DUPLICATE_EXACT (never overridable — add the existing song instead)
-- or DUPLICATE_SIMILAR (pass p_confirmed after the user confirms it differs),
-- with the candidates as JSON in the error detail.
create or replace function create_song(
  p_title text, p_artist text, p_url text, p_lyrics text, p_tags jsonb, p_confirmed boolean default false
) returns jsonb
language plpgsql
as $$
declare
  v_db uuid := (select active_db());
  v_exact jsonb;
  v_similar jsonb;
  v_shared uuid;
  v_entry db_songs;
begin
  if v_db is null then
    raise exception 'NOT_UNLOCKED';
  end if;
  if btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_artist, '')) = '' then
    raise exception 'TITLE_AND_ARTIST_REQUIRED';
  end if;

  select jsonb_agg(to_jsonb(m)) into v_exact
  from find_song_matches(p_title, p_artist, p_url) m where m.tier = 'exact';
  if v_exact is not null then
    raise exception 'DUPLICATE_EXACT' using detail = v_exact::text;
  end if;

  if not coalesce(p_confirmed, false) then
    select jsonb_agg(to_jsonb(m)) into v_similar
    from find_song_matches(p_title, p_artist, p_url) m where m.tier = 'similar';
    if v_similar is not null then
      raise exception 'DUPLICATE_SIMILAR' using detail = v_similar::text;
    end if;
  end if;

  insert into shared_songs (title, artist, ultimate_guitar_url, chord_chart, genre, owner_db)
  values (
    btrim(p_title), btrim(p_artist), btrim(coalesce(p_url, '')),
    nullif(btrim(coalesce(p_lyrics, '')), ''),
    nullif(btrim(coalesce(p_tags ->> 'genre_2', '')), ''),
    v_db
  )
  returning id into v_shared;

  insert into db_songs (db_id, shared_song_id, tags)
  values (v_db, v_shared, coalesce(p_tags, '{}'::jsonb) - 'genre_2')
  returning * into v_entry;

  return song_json(v_entry);
end;
$$;
grant execute on function create_song(text, text, text, text, jsonb, boolean) to anon, authenticated;

-- Removes a song from the unlocked database. If this database owned the shared
-- song and others still use it, ownership passes to the database that has had
-- it longest (adopting that database's own lyrics/genre if it had unlinked
-- them); the shared song is deleted only when nothing uses it any more.
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
  if not ((select app_key_can_write()) and e.db_id = (select active_db())) then
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

-- ── global edits that must reach every database ──────────────────────────
-- Renaming a rating label or a genre value has to rewrite songs in ALL
-- databases, which row-level security (scoped to one database) would block.
-- These run with elevated rights but only for the admin app password.
create or replace function rename_rating_label(p_old text, p_new text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not (select app_key_can_write()) then
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
  if not (select app_key_can_write()) then
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
  if not (select app_key_can_write()) then
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
