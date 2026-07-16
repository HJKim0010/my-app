create or replace view public.chat_events_review as
select
  participant_id,
  coalesce(user_query_type, detected_support_mode, query_type_label, 'other') as query_type_label,
  raw_user_query,
  assistant_response,
  policy_decision,
  status,
  task_id as episode,
  selected_category,
  detected_support_mode,
  feedback_target,
  redirect_reason,
  condition_label,
  session_id,
  interaction_count,
  session_duration_ms,
  response_length,
  retrieved_chunk_ids,
  retrieved_chunk_metadata,
  source_types_used,
  visual_assets_used,
  timestamp,
  created_at,
  id
from public.chat_events;

comment on view public.chat_events_review is
  'Researcher-friendly read view for chat_events. Keeps source table unchanged while presenting priority columns first and ep_id/task_id as episode.';
