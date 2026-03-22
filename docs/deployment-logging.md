# Supabase Logging Setup

Set these environment variables in local `.env.local` and in your deployment platform:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_CHAT_EVENTS_TABLE=chat_events`
- `SUPABASE_SESSION_TRANSCRIPTS_TABLE=session_transcripts`

Run the SQL in `docs/supabase-schema.sql` inside the Supabase SQL editor.

When Supabase variables are present, the app logs:

- per-turn chat events to `chat_events`
- verbatim session transcript snapshots to `session_transcripts`

When Supabase variables are missing, the app falls back to local JSONL log files for development.
