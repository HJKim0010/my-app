# Supabase Logging Setup

Set these environment variables in local `.env.local` and in your deployment platform:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_CHAT_EVENTS_TABLE=chat_events`
- `SUPABASE_SESSION_TRANSCRIPTS_TABLE=session_transcripts`

Run the SQL in `docs/supabase-schema.sql` inside the Supabase SQL editor.

Participant tracking requirements:

- every user must enter a participant ID before the chat starts
- the app now stores `participant_id` in both `chat_events` and `session_transcripts`
- the app stores episode IDs as `ep_id` with values `ep1` and `ep2`
- if you are updating an existing Supabase project, run the same SQL file again so the new
  column and indexes are added safely
- older rows without a participant ID are backfilled to `UNKNOWN` by the migration script
- older `task_id` values are migrated from `task1`/`task2` to `ep_id` values `ep1`/`ep2`
- row level security is enabled on both public logging tables; the app writes through the
  server-side Supabase service role key

When Supabase variables are present, the app logs:

- per-turn chat events to `chat_events`
- verbatim session transcript snapshots to `session_transcripts`

When Supabase variables are missing, the app falls back to local JSONL log files for development.
