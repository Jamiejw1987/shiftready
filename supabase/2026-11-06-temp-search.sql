-- Search box on Sign-ups → "Links sent, not finished yet".
-- One lowercase column with name, postcode (with and without the space) and
-- mobile digits, kept up to date automatically, plus a trigram index so
-- `ilike '%term%'` stays fast. (Already run in production on 2026-11-06.)

create extension if not exists pg_trgm;

alter table temps add column if not exists search_text text generated always as (
  lower(
    coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' ||
    coalesce(postcode,'') || ' ' || replace(coalesce(postcode,''),' ','') || ' ' ||
    regexp_replace(coalesce(mobile,''), '\D', '', 'g')
  )
) stored;

create index if not exists temps_search_trgm on temps using gin (search_text gin_trgm_ops);
