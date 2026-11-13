-- Any unlocked database may fill a shared song's chord chart when it has none.
-- It can never replace or clear an existing chart (that stays with the owning
-- database, or a per-database override). Used by "Import charts from files".
create or replace function fill_empty_chart(p_shared_song_id uuid, p_chart text) returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if (select active_db()) is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if btrim(coalesce(p_chart, '')) = '' then
    return false;
  end if;
  update shared_songs
  set chord_chart = p_chart
  where id = p_shared_song_id and btrim(coalesce(chord_chart, '')) = '';
  return found;
end;
$$;
grant execute on function fill_empty_chart(uuid, text) to anon, authenticated;
