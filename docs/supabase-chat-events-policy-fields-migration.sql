alter table public.chat_events
  add column if not exists policy_reason text,
  add column if not exists response_status text,
  add column if not exists detected_support_mode text,
  add column if not exists feedback_target text,
  add column if not exists input_origin text,
  add column if not exists source_condition text,
  add column if not exists support_condition text,
  add column if not exists task_id text,
  add column if not exists episode_id text,
  add column if not exists researcher_code text,
  add column if not exists incomplete_reason text;

alter table public.session_transcripts
  add column if not exists source_condition text,
  add column if not exists support_condition text,
  add column if not exists task_id text,
  add column if not exists episode_id text;

alter table public.chat_events
  add constraint chat_events_response_status_check
  check (
    response_status is null
    or response_status in ('success', 'redirected', 'incomplete', 'timeout', 'error')
  ) not valid;

alter table public.chat_events
  add constraint chat_events_input_origin_check
  check (
    input_origin is null
    or input_origin in ('typed', 'quick_reply', 'prefill_edited')
  ) not valid;

alter table public.chat_events
  add constraint chat_events_source_condition_check
  check (
    source_condition is null
    or source_condition in ('static', 'dynamic')
  ) not valid;

alter table public.chat_events
  add constraint chat_events_support_condition_check
  check (
    support_condition is null
    or support_condition in ('ai', 'non_ai')
  ) not valid;

comment on column public.chat_events.researcher_code is
  'Nullable post-hoc researcher coding field. Do not auto-fill or backfill from application logic.';
