-- Replaces the single audio_path with an ordered, titled list of
-- recordings per song — no cap, since nothing about storage or the UI
-- actually needs one. Each entry's path is {song_id}/{recording_id} in the
-- existing private "audio" bucket (same RLS as before, unaffected — it's
-- scoped to the whole bucket, not individual paths). No data to migrate:
-- audio_path was never actually populated on any song.

alter table songs add column if not exists recordings jsonb not null default '[]'::jsonb;
alter table songs drop column if exists audio_path;
