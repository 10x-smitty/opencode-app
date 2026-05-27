create table if not exists public.user_artists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  chartmetric_artist_id text not null,
  name text not null,
  image_url text,
  genres text[] not null default '{}',
  monthly_listeners integer,
  career_stage text,
  created_at timestamptz not null default now(),
  unique (user_id, chartmetric_artist_id)
);

create index if not exists user_artists_user_created_idx
  on public.user_artists (user_id, created_at desc);

alter table public.user_artists enable row level security;

drop policy if exists "Users can read their artists" on public.user_artists;
create policy "Users can read their artists"
  on public.user_artists for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their artists" on public.user_artists;
create policy "Users can insert their artists"
  on public.user_artists for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update their artists" on public.user_artists;
create policy "Users can update their artists"
  on public.user_artists for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their artists" on public.user_artists;
create policy "Users can delete their artists"
  on public.user_artists for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.user_artists to authenticated;
