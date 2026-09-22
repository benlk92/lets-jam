-- Each song can have one attached audio recording, stored in a private
-- Storage bucket (not public — the app reads it through an authenticated
-- download so it stays behind the same passphrase gate as everything else).
-- audio_path holds the object's path within that bucket; the file itself
-- never touches the songs table.

alter table songs add column if not exists audio_path text;

insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

-- Storage's RLS works the same way as PostgREST's — it forwards the same
-- request headers into request.headers, so app_key_valid() (defined in the
-- init migration) works unchanged here.
drop policy if exists "audio shared key access" on storage.objects;
create policy "audio shared key access" on storage.objects
  for all using (bucket_id = 'audio' and app_key_valid())
  with check (bucket_id = 'audio' and app_key_valid());
