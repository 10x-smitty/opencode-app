alter table public.user_artists
  add column if not exists bio text;
