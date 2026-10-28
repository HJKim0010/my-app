begin;

create table if not exists public.history_share_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  participant_id text not null,
  task_id text not null check (task_id in ('task1', 'task2')),
  session_id text not null,
  snapshot jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

alter table public.history_share_links enable row level security;
revoke all on table public.history_share_links from public, anon, authenticated;
grant select, insert, update, delete on table public.history_share_links to service_role;
create index if not exists history_share_links_session_idx
  on public.history_share_links (participant_id, task_id, session_id);

commit;
