-- Optional metadata for My Writing Assistant routing and research reproducibility.
-- Backward-compatible: all columns are nullable or have a safe default.

alter table if exists public.chat_events
  add column if not exists source_context_strategy text,
  add column if not exists detected_functions text[] default '{}',
  add column if not exists primary_detected_function text,
  add column if not exists secondary_detected_functions text[] default '{}',
  add column if not exists ghostwriting_boundary_triggered boolean default false;

comment on column public.chat_events.source_context_strategy is
  'Source context strategy used for the turn: none, canonical, targeted_rag, or canonical_plus_rag.';

comment on column public.chat_events.detected_functions is
  'Primary and secondary writing-support functions detected for the current user request.';

comment on column public.chat_events.ghostwriting_boundary_triggered is
  'Whether the response used the ghostwriting boundary for full continuation, paragraph, or full-draft requests.';
