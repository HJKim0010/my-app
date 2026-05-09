create table if not exists public.chat_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  participant_id text not null,
  session_id text not null,
  ep_id text not null,
  condition_label text not null,
  selected_category text not null,
  raw_user_query text not null,
  policy_decision text not null,
  status text not null,
  retrieved_chunk_ids jsonb not null default '[]'::jsonb,
  retrieved_chunk_metadata jsonb not null default '[]'::jsonb,
  assistant_response text not null,
  timestamp timestamptz not null,
  response_length integer not null,
  interaction_count integer not null,
  session_duration_ms bigint not null,
  query_type_label text,
  redirect_reason text,
  source_types_used jsonb not null default '[]'::jsonb,
  visual_assets_used jsonb not null default '[]'::jsonb
);

create table if not exists public.session_transcripts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  participant_id text not null,
  session_id text not null,
  ep_id text not null,
  condition_label text not null,
  timestamp timestamptz not null,
  interaction_count integer not null,
  session_duration_ms bigint not null,
  transcript jsonb not null
);

create index if not exists chat_events_session_id_idx
  on public.chat_events (session_id);

create index if not exists chat_events_participant_id_idx
  on public.chat_events (participant_id);

create index if not exists session_transcripts_session_id_idx
  on public.session_transcripts (session_id);

create index if not exists session_transcripts_participant_id_idx
  on public.session_transcripts (participant_id);

alter table public.chat_events
  add column if not exists participant_id text;

alter table public.session_transcripts
  add column if not exists participant_id text;

update public.chat_events
set participant_id = coalesce(nullif(participant_id, ''), 'UNKNOWN')
where participant_id is null or participant_id = '';

update public.session_transcripts
set participant_id = coalesce(nullif(participant_id, ''), 'UNKNOWN')
where participant_id is null or participant_id = '';

alter table public.chat_events
  alter column participant_id set not null;

alter table public.session_transcripts
  alter column participant_id set not null;

alter table public.chat_events
  add column if not exists ep_id text;

alter table public.session_transcripts
  add column if not exists ep_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_events'
      and column_name = 'task_id'
  ) then
    execute $sql$
      update public.chat_events
      set ep_id = case task_id
        when 'task1' then 'ep1'
        when 'task2' then 'ep2'
        else coalesce(nullif(ep_id, ''), task_id)
      end
      where ep_id is null or ep_id = '' or task_id in ('task1', 'task2')
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'session_transcripts'
      and column_name = 'task_id'
  ) then
    execute $sql$
      update public.session_transcripts
      set ep_id = case task_id
        when 'task1' then 'ep1'
        when 'task2' then 'ep2'
        else coalesce(nullif(ep_id, ''), task_id)
      end
      where ep_id is null or ep_id = '' or task_id in ('task1', 'task2')
    $sql$;
  end if;
end $$;

update public.chat_events
set ep_id = case ep_id
  when 'task1' then 'ep1'
  when 'task2' then 'ep2'
  else ep_id
end;

update public.session_transcripts
set ep_id = case ep_id
  when 'task1' then 'ep1'
  when 'task2' then 'ep2'
  else ep_id
end;

alter table public.chat_events
  alter column ep_id set not null;

alter table public.session_transcripts
  alter column ep_id set not null;

alter table public.chat_events
  drop column if exists task_id;

alter table public.session_transcripts
  drop column if exists task_id;

alter table public.chat_events enable row level security;

alter table public.session_transcripts enable row level security;
