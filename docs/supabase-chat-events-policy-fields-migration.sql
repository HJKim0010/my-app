alter table public.chat_events
  add column if not exists policy_reason text,
  add column if not exists response_status text,
  add column if not exists user_query_type text,
  add column if not exists detected_support_mode text,
  add column if not exists feedback_target text,
  add column if not exists input_origin text,
  add column if not exists source_condition text,
  add column if not exists support_condition text,
  add column if not exists task_id text,
  add column if not exists episode_id text,
  add column if not exists researcher_code text,
  add column if not exists incomplete_reason text,
  add column if not exists retrieval_executed boolean,
  add column if not exists retrieval_reason text,
  add column if not exists retrieval_skipped_reason text,
  add column if not exists intent text,
  add column if not exists request_is_explicit boolean,
  add column if not exists requires_source_context boolean,
  add column if not exists requires_task_context boolean,
  add column if not exists story_request_mode text,
  add column if not exists requires_exact_fact boolean,
  add column if not exists response_mode text,
  add column if not exists conversation_operation text,
  add column if not exists classifier_confidence double precision,
  add column if not exists scope_limitations jsonb not null default '[]'::jsonb,
  add column if not exists sub_request_count integer,
  add column if not exists selected_task_rule_id text,
  add column if not exists fallback_state text,
  add column if not exists recognized_story_entity text;

alter table public.session_transcripts
  add column if not exists source_condition text,
  add column if not exists support_condition text,
  add column if not exists task_id text,
  add column if not exists episode_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_events_response_status_check'
  ) then
    alter table public.chat_events
      add constraint chat_events_response_status_check
      check (
        response_status is null
        or response_status in ('success', 'redirected', 'incomplete', 'timeout', 'error')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chat_events_input_origin_check'
  ) then
    alter table public.chat_events
      add constraint chat_events_input_origin_check
      check (
        input_origin is null
        or input_origin in ('typed', 'quick_reply', 'prefill_edited')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chat_events_source_condition_check'
  ) then
    alter table public.chat_events
      add constraint chat_events_source_condition_check
      check (
        source_condition is null
        or source_condition in ('static', 'dynamic')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chat_events_support_condition_check'
  ) then
    alter table public.chat_events
      add constraint chat_events_support_condition_check
      check (
        support_condition is null
        or support_condition in ('ai', 'non_ai')
      ) not valid;
  end if;

  alter table public.chat_events
    drop constraint if exists chat_events_user_query_type_check;

  alter table public.chat_events
    add constraint chat_events_user_query_type_check
    check (
      user_query_type is null
      or user_query_type in (
        'comprehension',
        'idea_generation',
        'organization',
        'vocabulary_expression',
        'feedback_checking',
        'procedural',
        'restricted',
        'draft_only',
        'unclear_intent',
        'language_change_followup',
        'language_feedback',
        'source_alignment',
        'task_requirement',
        'other'
      )
    ) not valid;
end $$;

comment on column public.chat_events.researcher_code is
  'Nullable post-hoc researcher coding field. Do not auto-fill or backfill from application logic.';

comment on column public.chat_events.user_query_type is
  'Runtime user query type detected by the chatbot. Use as application metadata, not as final researcher coding.';

comment on column public.chat_events.retrieval_executed is
  'True when source retrieval was executed for this turn. False when skipped by intent gate.';

comment on column public.chat_events.retrieval_skipped_reason is
  'Reason retrieval was skipped, such as draft_only_unclear_intent or language_change_followup.';

comment on column public.chat_events.intent is
  'Fine-grained current-turn intent used by the conditional RAG gate.';

comment on column public.chat_events.requires_source_context is
  'True only when the current request genuinely needs original source/story material.';

comment on column public.chat_events.classifier_confidence is
  'Confidence score from the deterministic conditional RAG intent gate.';

comment on column public.chat_events.scope_limitations is
  'Participant-specified scope limits such as hints_only, keywords_only, no_full_sentences, no_grammar_check, or story_connection_only.';

comment on column public.chat_events.requires_task_context is
  'True when the current turn asks about structured task requirements rather than story source context.';

comment on column public.chat_events.selected_task_rule_id is
  'Structured task-rule identifier used for task requirement answers, such as word_count.';

comment on column public.chat_events.recognized_story_entity is
  'Lightweight active-story entity used for routing source-comprehension questions.';

comment on column public.chat_events.story_request_mode is
  'Story-related request mode: factual, interpretive, or generative.';

comment on column public.chat_events.requires_exact_fact is
  'True when the turn asks for a confirmed story fact rather than an interpretation or idea.';

comment on column public.chat_events.response_mode is
  'Planned answer style such as factual_answer, cautious_interpretation, or idea_options.';
