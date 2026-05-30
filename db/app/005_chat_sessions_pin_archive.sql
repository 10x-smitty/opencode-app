alter table public.chat_sessions
  add column if not exists pinned_at timestamptz;

alter table public.chat_sessions
  add column if not exists archived_at timestamptz;

create index if not exists chat_sessions_user_pinned_idx
  on public.chat_sessions (user_id, pinned_at desc) where pinned_at is not null;
