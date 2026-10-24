-- Multi-database groundwork — ADDITIVE ONLY. Nothing here touches the
-- existing songs/categories/playlists tables, so the live app keeps working
-- exactly as before until the new client is deployed and cut over.
--
-- Model:
--   app_databases  — a password-protected database (Pop Songs, Circle Songs, ...)
--   shared_songs   — one row per distinct song: title, artist, link, lyrics,
--                    genre. Readable by everyone with the app password;
--                    editable only from the database that created it (owner_db).
--   db_songs       — one row per song *in* a database: all the per-database
--                    state (tags, memorized, play count, staleness, recordings).
--                    Lyrics and genre track the shared song unless "unlinked".
--   db_categories / db_playlists / db_playlist_songs / db_playlist_leaders —
--                    the per-database versions of what used to be keyed by `space`.
--   global_settings — values shared by every database (the Genre value list).
--
-- The new tables have row security ON and no policies yet (deny-all for the
-- public API); access rules arrive with the client that uses them.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ── matching keys ────────────────────────────────────────────────────────
-- text_key: what "the same title/artist" means for an exact match — case,
-- punctuation, accents, "&" vs "and", and a leading "the/a/an" don't count.
-- Parentheticals like "(Live)" deliberately DO count here; near-matches that
-- differ only by those are caught by the softer "similar song" check instead.
create or replace function text_key(t text) returns text
language sql immutable parallel safe
set search_path = public, extensions
as $$
  select coalesce(
    nullif(
      regexp_replace(
        btrim(
          regexp_replace(
            regexp_replace(lower(unaccent(coalesce(t, ''))), '&', ' and ', 'g'),
            '[^[:alnum:]]+', ' ', 'g'
          )
        ),
        '^(the|a|an) ', ''
      ),
      ''
    ),
    lower(btrim(coalesce(t, '')))
  )
$$;

-- link_key: Ultimate Guitar links are the same song when they share a tab id,
-- whatever the URL spelling; any other link is compared with the scheme,
-- "www.", fragment and trailing slash removed.
create or replace function link_key(u text) returns text
language sql immutable parallel safe
as $$
  select case
    when btrim(coalesce(u, '')) = '' then null
    when u ~* 'ultimate-guitar\.com'
         and (u ~ 'tab_id=[0-9]+' or u ~ '[0-9]{4,}\s*$') then
      'ug:' || coalesce((regexp_match(u, 'tab_id=([0-9]+)'))[1], (regexp_match(u, '([0-9]{4,})\s*$'))[1])
    else
      regexp_replace(regexp_replace(lower(btrim(u)), '^https?://(www\.)?', ''), '(#.*|/)$', '')
  end
$$;

-- ── databases ────────────────────────────────────────────────────────────
create table if not exists app_databases (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists app_databases_name_key on app_databases (lower(name));

-- ── shared songs ─────────────────────────────────────────────────────────
create table if not exists shared_songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  ultimate_guitar_url text not null default '',
  chord_chart text,
  genre text,
  owner_db uuid not null references app_databases (id),
  title_key text not null default '',
  artist_key text not null default '',
  link_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shared_songs_identity on shared_songs (title_key, artist_key);
create unique index if not exists shared_songs_link on shared_songs (link_key) where link_key is not null;
create index if not exists shared_songs_title_trgm on shared_songs using gin (title_key extensions.gin_trgm_ops);
create index if not exists shared_songs_owner on shared_songs (owner_db);

create or replace function shared_songs_before_write() returns trigger
language plpgsql
as $$
begin
  new.title_key := text_key(new.title);
  new.artist_key := text_key(new.artist);
  new.link_key := link_key(new.ultimate_guitar_url);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists shared_songs_keys on shared_songs;
create trigger shared_songs_keys
  before insert or update on shared_songs
  for each row execute function shared_songs_before_write();

-- ── a song within a database ─────────────────────────────────────────────
-- id is the old songs.id for migrated rows, so playlist rows and audio paths
-- ({song_id}/{recording_id}) keep pointing at the right thing.
create table if not exists db_songs (
  id uuid primary key default gen_random_uuid(),
  db_id uuid not null references app_databases (id) on delete cascade,
  shared_song_id uuid not null references shared_songs (id) on delete restrict,
  memorized boolean not null default false,
  last_played_at timestamptz,
  last_rating_label text,
  play_count integer not null default 0,
  tags jsonb not null default '{}'::jsonb,
  not_applicable_categories jsonb not null default '[]'::jsonb,
  recordings jsonb not null default '[]'::jsonb,
  -- Lyrics and genre follow the shared song until "unlinked" here; a separate
  -- flag (not just a null override) so an unlinked-and-cleared value is possible.
  lyrics_unlinked boolean not null default false,
  chord_chart_override text,
  genre_unlinked boolean not null default false,
  genre_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (db_id, shared_song_id)
);

create index if not exists db_songs_db on db_songs (db_id);
create index if not exists db_songs_shared on db_songs (shared_song_id);
create index if not exists db_songs_tags_gin on db_songs using gin (tags);

drop trigger if exists db_songs_set_updated_at on db_songs;
create trigger db_songs_set_updated_at
  before update on db_songs
  for each row execute function set_updated_at();

-- ── per-database categories, playlists, leaders ──────────────────────────
create table if not exists db_categories (
  id text not null,
  db_id uuid not null references app_databases (id) on delete cascade,
  name text not null,
  type text not null check (type in ('single', 'multi', 'range')),
  computed boolean not null default false,
  guided_picker_enabled boolean not null default true,
  scatter_picker_enabled boolean not null default false,
  sort_order integer not null,
  "values" jsonb not null default '[]'::jsonb,
  primary key (db_id, id)
);

create table if not exists db_playlists (
  id uuid primary key default gen_random_uuid(),
  db_id uuid not null references app_databases (id) on delete cascade,
  name text not null,
  show_date date,
  created_at timestamptz not null default now()
);

create table if not exists db_playlist_songs (
  playlist_id uuid not null references db_playlists (id) on delete cascade,
  song_id uuid not null references db_songs (id) on delete cascade,
  sort_order integer not null,
  leader text,
  primary key (playlist_id, song_id)
);
create index if not exists db_playlist_songs_order on db_playlist_songs (playlist_id, sort_order);

create table if not exists db_playlist_leaders (
  db_id uuid not null references app_databases (id) on delete cascade,
  name text not null,
  sort_order integer not null,
  primary key (db_id, name)
);

create table if not exists global_settings (
  key text primary key,
  value jsonb not null
);

alter table app_databases enable row level security;
alter table shared_songs enable row level security;
alter table db_songs enable row level security;
alter table db_categories enable row level security;
alter table db_playlists enable row level security;
alter table db_playlist_songs enable row level security;
alter table db_playlist_leaders enable row level security;
alter table global_settings enable row level security;

revoke all on app_databases from anon, authenticated;

-- ── the transform ────────────────────────────────────────────────────────
-- Rebuilds everything belonging to the two legacy databases from the old
-- tables. Safe to re-run: it only ever deletes/recreates rows owned by Pop
-- Songs and Circle Songs, never the old tables. Refuses to run (rather than
-- silently dropping data) if two songs inside one database would collapse
-- into one, or if one link is claimed by two different songs.
--
-- Songs present in both databases become ONE shared song owned by Circle
-- Songs; each database keeps its own entry (tags, recordings, stats). The
-- shared lyrics/genre are the owner's; a non-owner entry whose own lyrics or
-- genre differ keeps them as an unlinked override rather than losing them.
create or replace function migrate_legacy_to_multidb() returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_pass text;
  v_pop uuid;
  v_circle uuid;
  v_n integer;
  v_registered text[];
  v_extras text[];
begin
  select passphrase into v_pass from app_config where id;
  if v_pass is null then
    raise exception 'app_config has no passphrase to carry over';
  end if;

  insert into app_databases (name, password_hash)
  select v.n, crypt(v_pass, gen_salt('bf'))
  from (values ('Pop Songs'), ('Circle Songs')) as v(n)
  where not exists (select 1 from app_databases d where lower(d.name) = lower(v.n));

  select id into v_pop from app_databases where lower(name) = 'pop songs';
  select id into v_circle from app_databases where lower(name) = 'circle songs';

  delete from db_playlist_songs where playlist_id in (select id from db_playlists where db_id in (v_pop, v_circle));
  delete from db_playlists where db_id in (v_pop, v_circle);
  delete from db_playlist_leaders where db_id in (v_pop, v_circle);
  delete from db_categories where db_id in (v_pop, v_circle);
  delete from db_songs where db_id in (v_pop, v_circle);
  delete from shared_songs where owner_db in (v_pop, v_circle);

  create temp table _legacy on commit drop as
  select s.*,
         case s.space when 'circle_songs' then v_circle else v_pop end as db_id,
         text_key(s.title) as tk,
         text_key(s.artist) as ak,
         link_key(s.ultimate_guitar_url) as lk
  from songs s;

  select count(*) into v_n from (select 1 from _legacy group by tk, ak, db_id having count(*) > 1) x;
  if v_n > 0 then
    raise exception '% title/artist groups appear twice inside one database — resolve before migrating', v_n;
  end if;

  select count(*) into v_n from (
    select 1 from _legacy where lk is not null group by lk having count(distinct (tk, ak)) > 1
  ) x;
  if v_n > 0 then
    raise exception '% links are shared by different songs — resolve before migrating', v_n;
  end if;

  create temp table _groups on commit drop as
  select gen_random_uuid() as shared_id,
         tk,
         ak,
         case when bool_or(db_id = v_circle) then v_circle else v_pop end as owner_db
  from _legacy
  group by tk, ak;

  insert into shared_songs (id, title, artist, ultimate_guitar_url, chord_chart, genre, owner_db, created_at, updated_at)
  select g.shared_id,
         o.title,
         o.artist,
         coalesce(nullif(o.ultimate_guitar_url, ''), x.other_url, ''),
         nullif(o.chord_chart, ''),
         nullif(o.tags ->> 'genre_2', ''),
         g.owner_db,
         o.created_at,
         o.updated_at
  from _groups g
  join _legacy o on o.tk = g.tk and o.ak = g.ak and o.db_id = g.owner_db
  left join lateral (
    select max(l.ultimate_guitar_url) as other_url
    from _legacy l
    where l.tk = g.tk and l.ak = g.ak and l.db_id <> g.owner_db and l.ultimate_guitar_url <> ''
  ) x on true;

  insert into db_songs (
    id, db_id, shared_song_id, memorized, last_played_at, last_rating_label, play_count,
    tags, not_applicable_categories, recordings,
    lyrics_unlinked, chord_chart_override, genre_unlinked, genre_override,
    created_at, updated_at
  )
  select l.id, l.db_id, g.shared_id, l.memorized, l.last_played_at, l.last_rating_label, l.play_count,
         l.tags - 'genre_2', l.not_applicable_categories, l.recordings,
         d.lyrics_differ, case when d.lyrics_differ then l.chord_chart end,
         d.genre_differ, case when d.genre_differ then l.tags ->> 'genre_2' end,
         l.created_at, l.updated_at
  from _legacy l
  join _groups g on g.tk = l.tk and g.ak = l.ak
  join shared_songs s on s.id = g.shared_id
  cross join lateral (
    select (l.db_id <> g.owner_db
              and nullif(l.chord_chart, '') is not null
              and l.chord_chart is distinct from s.chord_chart) as lyrics_differ,
           (l.db_id <> g.owner_db
              and nullif(l.tags ->> 'genre_2', '') is not null
              and (l.tags ->> 'genre_2') is distinct from s.genre) as genre_differ
  ) d;

  insert into db_categories (id, db_id, name, type, computed, guided_picker_enabled, scatter_picker_enabled, sort_order, "values")
  select c.id,
         case c.space when 'circle_songs' then v_circle else v_pop end,
         c.name, c.type, c.computed, c.guided_picker_enabled, c.scatter_picker_enabled, c.sort_order,
         case when c.id = 'genre_2' then '[]'::jsonb else c."values" end
  from categories c;

  -- Genre is a permanent category in every database; its value list is global.
  insert into db_categories (id, db_id, name, type, computed, guided_picker_enabled, scatter_picker_enabled, sort_order, "values")
  select 'genre_2', d, 'Genre', 'single', false, false, false,
         coalesce((select max(x.sort_order) from db_categories x where x.db_id = d), -1) + 1,
         '[]'::jsonb
  from unnest(array[v_pop, v_circle]) as d
  where not exists (select 1 from db_categories x where x.db_id = d and x.id = 'genre_2');

  v_registered := coalesce((
    select array_agg(e.v order by e.o)
    from jsonb_array_elements_text(
      (select c."values" from categories c where c.id = 'genre_2' and c.space = 'pop_songs')
    ) with ordinality as e(v, o)
  ), '{}');
  v_extras := coalesce((
    select array_agg(q.g order by q.g)
    from (
      select distinct s.tags ->> 'genre_2' as g
      from songs s
      where nullif(s.tags ->> 'genre_2', '') is not null
    ) q
    where q.g <> all (v_registered)
  ), '{}');
  insert into global_settings (key, value)
  values ('genre_values', to_jsonb(v_registered || v_extras))
  on conflict (key) do update set value = excluded.value;

  insert into db_playlists (id, db_id, name, show_date, created_at)
  select p.id, case p.space when 'circle_songs' then v_circle else v_pop end, p.name, p.show_date, p.created_at
  from playlists p;

  insert into db_playlist_songs (playlist_id, song_id, sort_order, leader)
  select ps.playlist_id, ps.song_id, ps.sort_order, ps.leader from playlist_songs ps;

  insert into db_playlist_leaders (db_id, name, sort_order)
  select d, l.name, l.sort_order
  from playlist_leaders l
  cross join unnest(array[v_pop, v_circle]) as d;

  return jsonb_build_object(
    'databases', (select count(*) from app_databases),
    'shared_songs', (select count(*) from shared_songs),
    'db_songs', (select count(*) from db_songs),
    'categories', (select count(*) from db_categories),
    'playlists', (select count(*) from db_playlists),
    'playlist_songs', (select count(*) from db_playlist_songs),
    'leaders', (select count(*) from db_playlist_leaders),
    'genre_values', (select jsonb_array_length(value) from global_settings where key = 'genre_values')
  );
end;
$$;

revoke execute on function migrate_legacy_to_multidb() from public, anon, authenticated;
