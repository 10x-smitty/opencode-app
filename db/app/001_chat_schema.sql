create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New chat',
  opencode_session_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_created_idx
  on public.chat_sessions (user_id, created_at);

create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at);

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "Users can read their chat sessions" on public.chat_sessions;
create policy "Users can read their chat sessions"
  on public.chat_sessions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their chat sessions" on public.chat_sessions;
create policy "Users can insert their chat sessions"
  on public.chat_sessions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can read their chat messages" on public.chat_messages;
create policy "Users can read their chat messages"
  on public.chat_messages for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their chat messages" on public.chat_messages;
create policy "Users can insert their chat messages"
  on public.chat_messages for insert
  to authenticated
  with check (user_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select, insert on public.chat_sessions to authenticated;
grant select, insert on public.chat_messages to authenticated;
