-- btrim() only strips spaces, so a chart of nothing but newlines counted as
-- "present" and a blank-with-newlines chart could be stored. Test with a
-- whitespace-class regex instead.
create or replace function fill_empty_chart(p_shared_song_id uuid, p_chart text) returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if (select active_db()) is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if coalesce(p_chart, '') !~ '\S' then
    return false;
  end if;
  update shared_songs
  set chord_chart = p_chart
  where id = p_shared_song_id and coalesce(chord_chart, '') !~ '\S';
  return found;
end;
$$;
