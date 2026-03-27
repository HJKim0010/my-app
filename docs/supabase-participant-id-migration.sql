alter table if exists public.chat_events
  add column if not exists participant_id text;

update public.chat_events
set participant_id = 'anonymous'
where participant_id is null;

alter table if exists public.chat_events
  alter column participant_id set not null;

create index if not exists chat_events_participant_id_idx
  on public.chat_events (participant_id);

alter table if exists public.session_transcripts
  add column if not exists participant_id text;

update public.session_transcripts
set participant_id = 'anonymous'
where participant_id is null;

alter table if exists public.session_transcripts
  alter column participant_id set not null;

create index if not exists session_transcripts_participant_id_idx
  on public.session_transcripts (participant_id);
