-- An Ultimate Guitar link is the same tab with or without a trailing slash or
-- query string; the first version of link_key only recognised the bare form.
create or replace function link_key(u text) returns text
language sql immutable parallel safe
as $$
  select case
    when btrim(coalesce(u, '')) = '' then null
    when u ~* 'ultimate-guitar\.com'
         and (u ~ 'tab_id=[0-9]+' or u ~ '[0-9]{4,}/?\s*(\?.*)?$') then
      'ug:' || coalesce(
        (regexp_match(u, 'tab_id=([0-9]+)'))[1],
        (regexp_match(u, '([0-9]{4,})/?\s*(\?.*)?$'))[1]
      )
    else
      regexp_replace(regexp_replace(lower(btrim(u)), '^https?://(www\.)?', ''), '(#.*|/)$', '')
  end
$$;

-- Recompute stored keys for any row the new rules read differently.
update shared_songs
set ultimate_guitar_url = ultimate_guitar_url
where link_key is distinct from link_key(ultimate_guitar_url);
