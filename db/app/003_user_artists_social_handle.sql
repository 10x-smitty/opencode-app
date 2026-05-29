alter table public.user_artists
  add column if not exists social_handle text;
