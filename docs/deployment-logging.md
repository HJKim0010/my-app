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

## Teacher history (local and deployed)

The participant Start screen restores browser-local conversations. Teacher history
at `/history` reads saved Supabase records after a separate administrator login.

Required server-only variables in `.env.local` and Vercel Production:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HISTORY_ADMIN_EMAIL`: the single teacher email allowed to read history

Create that email account in Supabase **Authentication > Users > Add user > Create
new user**, choose a dedicated password, and confirm the user. This is an app Auth
account, separate from signing into the Supabase or Vercel dashboard with GitHub.
Do not put passwords or service keys in source code or NEXT_PUBLIC variables.

Run locally with `npm.cmd run dev -- --hostname 127.0.0.1`, then open
`http://127.0.0.1:3000/history`. After deployment, use the site's `/history` address
on any computer. Sign in, enter P44, click **?? ????**, and select Story B.
The browser session expires after at most one hour; sign in again when requested.
Logout clears the session cookie and revokes that Supabase refresh session.

Every history API request verifies the access token with Supabase Auth and checks
the confirmed email against the server allowlist. Missing configuration denies
access. Cookies are HttpOnly, SameSite=Strict and Secure in production; credentials
and history responses are not cached. No public signup or password reset endpoint
is exposed. Password recovery is managed by the project owner in Supabase.

The viewer reuses the chat styles and assistant renderer, preserving saved content
without generating replies or changing conversation records. Snapshots are combined
with later chat events per session, retaining repeated text on distinct turns.

Checks:

```sh
node --experimental-strip-types scripts/history-archive-tests.mjs
node --conditions=react-server --experimental-strip-types scripts/history-auth-tests.mjs
npm run build
```

## Share one conversation without recipient login

Apply `docs/supabase-history-shares.sql` once to the existing Supabase project.
It creates a separate RLS-protected table; anon/authenticated roles have no grants.
No new service, domain, or paid plan is required. Snapshots use the existing database
quota. Expired snapshots remain stored until cleaned up by the project owner;
revoking a link clears its snapshot immediately while retaining its metadata.

In `/history`, load the participant and select the Story and session. Expand
**이 대화 공유하기**, choose 1 hour (default), 6 hours, 12 hours, 24 hours, or
**만료 날짜·시간 직접 지정**, then create and copy the link. Custom dates are entered
and displayed in Korean time (Asia/Seoul), independent of the device timezone.
Links open immediately and expire at the selected future time; custom deadlines may
exceed 24 hours. The server enforces the saved expiry. Presets run from creation,
not the recipient's first visit. Existing links retain their saved expiry;
create a new link to choose a different deadline.
Recipients can only view: they cannot send, edit, delete, or browse other conversations.
Only the teacher can create, list, or revoke links. Up to 10 active
links per session are allowed by the application.

Recipients open `/shared#<random-token>` without login. They see only the frozen
snapshot of that session at creation; later messages and other sessions are not
included. The 256-bit token is stored only as a SHA-256 hash. The raw token is
shown once, and kept in the URL fragment to avoid request-path and referrer logs.
The browser sends it in a no-cache POST body; never add analytics or body logging
to this route. The shared page has no indexing or referrer metadata.

Anyone receiving a forwarded link can read it until expiry or revocation. Revocation
blocks subsequent requests; open views recheck every 30 seconds and clear themselves
on denial or connection failure. It cannot retract screenshots or saved copies.

Test with `node --conditions=react-server --experimental-strip-types scripts/history-share-tests.mjs`.
