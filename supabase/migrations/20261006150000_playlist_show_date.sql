-- The date a playlist is (or was) played — playlists are mostly used to plan
-- a show, so this is what the history matrix sorts on. Nullable: existing and
-- ad-hoc playlists simply have no date.

alter table playlists add column if not exists show_date date;
