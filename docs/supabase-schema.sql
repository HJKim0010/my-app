create table if not exists public.chat_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
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

create index if not exists session_transcripts_session_id_idx
  on public.session_transcripts (session_id);
