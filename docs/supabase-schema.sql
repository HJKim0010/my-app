create table if not exists public.chat_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  participant_id text not null,
  session_id text not null,
  task_id text not null,
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
  task_id text not null,
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
