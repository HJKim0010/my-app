# Chatbot External Review Handoff

This document describes how the writing-support chatbot currently routes, grounds, constrains, generates, logs, and returns responses. It is intended for external review of response logic and context handling. Do not place secrets or participant log data in this document.

## A. Overall Architecture

### End-to-end response flow

1. **Frontend chat UI**
   - File: `app/page.tsx`
   - Component: `Home`
   - Main send function: `send(overrideText?, inputOrigin?)`
   - The user message is appended to the active task's local message list and an empty streaming assistant message is inserted.
   - The frontend posts to `/api/chat` with:
     - `taskId`
     - `participantId`
     - `query`
     - `recentMessages`
     - `category`
     - `condition`
     - `sessionId`
     - `interactionCount`
     - `sessionStartedAt`
     - `input_origin`
     - `stream: true`
   - The frontend reads an NDJSON stream and updates the assistant message on each `delta` event.

2. **Chat API route**
   - File: `app/api/chat/route.ts`
   - Handler: `POST(request: NextRequest)`
   - Parses request body, normalizes IDs, validates participant ID, loads task package, performs policy analysis, builds conversation memory, classifies current request, conditionally retrieves source context, and calls OpenAI.

3. **Policy processing**
   - File: `backend/policy/classifier.ts`
   - Entry point: `analyzeQueryScope(query)`
   - Restricted requests are redirected before retrieval/OpenAI generation.
   - Redirect file: `backend/policy/redirect.ts`
   - Redirect entry point: `redirectResponse(reason, language, query)`

4. **Conversation memory and current-turn intent**
   - File: `backend/rag/conversationMemory.ts`
   - Entry point: `buildConversationMemory(taskId, query, recentMessages)`
   - Context priority helper: `backend/rag/contextPriority.ts`
   - Key functions:
     - `looksLikeNewCurrentLanguageIntent(query)`
     - `shouldTreatAsContinuationFollowUp(query, recentMessages)`

5. **Prompt/context assembly**
   - File: `backend/rag/promptBuilder.ts`
   - System instruction: `buildSystemInstruction(language, mode, continuationMode)`
   - User prompt sections: `buildUserInput(...)`
   - The final OpenAI request uses:
     - `instructions`: generated system prompt
     - `input[0].content[0].text`: sectioned user/context prompt

6. **Source retrieval/RAG**
   - Files:
     - `backend/rag/loader.ts`
     - `backend/rag/chunker.ts`
     - `backend/rag/retriever.ts`
     - `backend/rag/lexicon.ts`
     - `backend/rag/assetResolver.ts`
   - Retrieval is conditional. It runs only when `classifyCurrentRequest(...)` sets `requires_source_context: true`.
   - Retrieval query is built by `buildRetrievalQuery(...)` in `app/api/chat/route.ts`.
   - Chunks are created by `chunkDocuments(...)`, scored by `scoreChunk(...)`, and returned by `retrieveTaskChunks(...)`.

7. **OpenAI API**
   - File: `app/api/chat/route.ts`
   - Client construction: `new OpenAI({ apiKey })`
   - Main generation call: `client.responses.create({ ...openAIRequest, stream: true }, { signal })`
   - Language-change follow-up call: `client.responses.create(...)` without streaming.

8. **Logging**
   - File: `backend/logs/logger.ts`
   - Main functions:
     - `appendChatLog(entry)`
     - `appendSessionTranscript(entry)`
   - Supabase is used when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present.
   - Otherwise logs are appended locally to `backend/logs/chat-log.jsonl` and `backend/logs/session-transcripts.jsonl`. These local JSONL files contain actual chat text and are excluded from the review bundle.

9. **Frontend response display**
   - File: `app/page.tsx`
   - Streaming events:
     - `start`
     - `delta`
     - `done`
     - `error`
   - Parser: `isChatStreamEvent(...)`
   - The assistant message is updated incrementally during stream reading.

## B. Model and API Settings

### OpenAI model

- Main model is selected in `app/api/chat/route.ts`:
  - `process.env.OPENAI_MODEL || "gpt-5.4-mini"`
- The same default is used for both:
  - regular chat generation
  - `language_change` follow-up generation

### Generation parameters

- `max_output_tokens`:
  - `Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 1200)`
- `temperature`:
  - Not explicitly set in the code.
- `timeout`:
  - `Number(process.env.OPENAI_TIMEOUT_MS || 45000)`
  - Implemented with `AbortController`.
- API route duration:
  - `export const maxDuration = 60` in `app/api/chat/route.ts`

### API call locations

- Regular streaming generation:
  - `app/api/chat/route.ts`
  - Near construction of `openAIRequest`
  - `client.responses.create({ ...openAIRequest, stream: true }, { signal: openAIController.signal })`
- Language-change follow-up:
  - `app/api/chat/route.ts`
  - `requestClassification.intent === "language_change"`
  - `client.responses.create(...)` without `stream: true`

### Request data structure from frontend

`app/page.tsx` sends a JSON POST body to `/api/chat`:

```json
{
  "taskId": "task1 | task2",
  "participantId": "...",
  "query": "...",
  "recentMessages": [{ "role": "user | assistant", "text": "..." }],
  "category": "Others",
  "condition": "static | dynamic",
  "sessionId": "...",
  "interactionCount": 1,
  "sessionStartedAt": 0,
  "input_origin": "typed | quick_reply | prefill_edited",
  "stream": true
}
```

### Response data structure

The API returns either JSON or NDJSON stream events.

Main response shape:

```ts
type ChatApiResponse = {
  ok: boolean;
  requestId: string;
  status: "success" | "redirected" | "incomplete" | "timeout" | "error";
  text: string;
  reason: string | null;
  quickReplies: QuickReply[];
};
```

Streaming event shape:

```ts
type ChatStreamEvent =
  | { type: "start"; requestId: string }
  | { type: "delta"; delta: string }
  | { type: "done"; payload: ChatApiResponse }
  | { type: "error"; payload: ChatApiResponse };
```

### Streaming

- The regular OpenAI call uses streaming.
- API response content type:
  - `application/x-ndjson; charset=utf-8`
- Frontend reads the stream via `res.body.getReader()`.
- Each OpenAI `response.output_text.delta` becomes a frontend `delta` event.

### Retry, timeout, error handling

- OpenAI timeout uses `AbortController`.
- The request abort signal also aborts the OpenAI request.
- There is no OpenAI retry loop in the regular generation path.
- Supabase logging has a fallback path:
  - Try current schema.
  - If error mentions `ep_id` or `task_id`, retry with legacy task ID mapping.
  - If Supabase fails or is not configured, append to local JSONL logs.
- On missing `OPENAI_API_KEY`, the API returns a service error response and logs `missing_api_key`.

## C. Prompts

### Prompt files and builders

Active prompt assembly is in:

- `backend/rag/promptBuilder.ts`
  - `buildSystemInstruction(...)`
  - `buildUserInput(...)`
  - `buildModeInstruction(...)`
  - `buildSentenceSupportInstruction(...)`
  - `buildContextFollowUpInstruction(...)`

Reference or legacy prompt files also exist:

- `prompts/system/masterSystemPrompt.txt`
- `prompts/system/policyPrompt.txt`
- `prompts/system/categoryPrompt.txt`
- `prompts/task/task1_static.txt`
- `prompts/task/task1_dynamic.txt`

The current API route imports `buildSystemInstruction` and `buildUserInput` from `backend/rag/promptBuilder.ts`; it does not directly read the `prompts/system/*.txt` files during the normal chat route.

### EP1 and EP2 task configuration

Task packages are loaded by `loadTaskPackage(taskId, condition)` in `backend/rag/loader.ts`.

EP1 / task1:

- `data/task1/task.json`
- `data/task1/prompt.txt`
- `data/task1/instruction.txt`
- `data/task1/source_text.txt`
- `data/task1/static/raw/source_text.txt`
- `data/task1/dynamic/processed/video_transcript.txt`
- `data/task1/static/processed/audio_transcript.txt`
- `data/task1/static/processed/image_descriptions.json`
- `data/task1/dynamic/processed/scene_labels.json`
- `data/task1/task1-lexicon.json`
- `data/task1/task1-lexicon-source.json`

EP2 / task2:

- `data/task2/task.json`
- `data/task2/prompt.txt`
- `data/task2/instruction.txt`
- `data/task2/source_text.txt`
- `data/task2/static/raw/source_text.txt`
- `data/task2/dynamic/processed/video_transcript.txt`
- `data/task2/static/processed/audio_transcript.txt`
- `data/task2/static/processed/image_descriptions.json`
- `data/task2/dynamic/processed/scene_labels.json`
- `data/task2/task2-lexicon.json`
- `data/task2/task2-lexicon-source.json`

Images, audio, video, embeddings, and generated large processed assets are not needed for the code-level review bundle and are excluded.

### Final prompt section order

`buildUserInput(...)` creates a sectioned prompt. Important sections include:

1. Metadata lines:
   - `Episode`
   - `Category`
   - `Support mode`
   - `Response language`
   - `Working context`
   - `Story request mode`
   - `Requires exact fact`
   - `Response mode`
   - `Active support context`
   - `Contextual follow-up`
   - `Prior message count`
   - `Active learner-selected direction`
   - `Resolved movement reference`
   - `Resolved accepted assistant offer`
2. Priority/instruction lines:
   - `CURRENT_USER_REQUEST has priority over RELEVANT_CHAT_HISTORY`
   - `Do not continue correcting or explaining an earlier sentence unless CURRENT_USER_REQUEST explicitly refers to it`
3. `<ASSISTANCE_POLICY>`
4. `<TASK_CONTEXT>`
5. `<RELEVANT_CHAT_HISTORY>`
6. `<LEARNER_DRAFT>`
7. Optional `<RETRIEVED_SOURCE_CONTEXT>` when retrieval runs
8. `<ASSISTANT_SUGGESTIONS_CONTEXT>`
9. `<CURRENT_USER_REQUEST>`

The OpenAI Responses API receives this text as a user message, while the system instruction is passed separately via the `instructions` field.

### Policy prompts and constraints

Defined primarily in `backend/rag/promptBuilder.ts`:

- No full continuation or paragraph writing.
- No model answer.
- Korean-to-English whole-sentence translation should be scaffolded, not directly completed.
- Short words/phrases can be translated directly.
- Source facts must come only from retrieved source context.
- Learner-created ideas must not be presented as source facts.
- Feedback/proofreading can provide corrected wording while preserving meaning.
- Task push is allowed only after answering the current question.

Redirect scaffolds are defined in `backend/policy/redirect.ts`.

## D. Conversation Context Management

### Storage and loading

Frontend state:

- File: `app/page.tsx`
- State shape:
  - `taskStates: Record<TaskId, TaskChatState>`
  - Each `TaskChatState` has its own messages, session ID, interaction count, session start time, and transcript status.
- Persistence:
  - `localStorage` under participant-specific key from `getStorageKey(participantId)`
  - Current participant ID under `CURRENT_PARTICIPANT_KEY`

Backend receives context:

- `recentMessages` is sent in each `/api/chat` request.
- The frontend uses the selected task's active message list:
  - `currentState.messages.filter((message) => message.id !== "welcome").map(({ role, text }) => ({ role, text }))`
- The current user message is not included in `recentMessages`; it is sent separately as `query`.

### Recent message limits

`backend/rag/conversationMemory.ts` defines:

- `MAX_RECENT_MESSAGES = 12`
- `MAX_ANCHOR_MESSAGES = 8`
- `MAX_HISTORY_LINE_LENGTH = 220`

`buildRecentSummary(...)` uses the last 12 messages.

`buildFullHistorySummary(...)` preserves:

- First 4 messages
- Durable anchor messages
- Last 12 messages

### Ordering

Frontend:

- Active state appends user message then pending assistant message.
- API request sends the pre-send `currentState.messages`, so `recentMessages` contains previous turns only.

Backend prompt:

- `recentMessages` is summarized into `RELEVANT_CHAT_HISTORY`.
- `query` becomes `CURRENT_USER_REQUEST`.
- Current user request is placed later in the prompt and also explicitly marked as higher priority.

### Episode switching and task state

- `selectedTask` is `task1` or `task2`.
- Each task has separate state in `taskStates`.
- Switching task changes active state and URL query params.
- API maps task to episode:
  - `task1 -> ep1`
  - `task2 -> ep2`
- Because frontend sends `currentState.messages` for `selectedTask`, EP1 history should not normally be sent with EP2 requests.

### IDs and separation

- `participantId`: normalized participant identifier.
- `sessionId`: generated per `TaskChatState`.
- `taskId`: `task1` or `task2`.
- `epId` / `episode_id`: `ep1` or `ep2`.
- `condition`: `static` or `dynamic`.

### Possible stale state locations

Reviewers should inspect:

- `app/page.tsx`
  - `selectedTask`
  - `taskStates`
  - `taskStatesRef`
  - `currentState.messages`
  - `localStorage` rehydration around participant login/guide acceptance
- `backend/rag/conversationMemory.ts`
  - `buildFullHistorySummary`
  - durable anchors
  - `activeSupportContext`
  - `isContextualFollowUp`
- `app/api/chat/route.ts`
  - `classifyCurrentRequest(...)`
  - `looksLikeContinuationFollowUp(...)`
  - `acceptsPreviousEventSequenceOffer(...)`
  - `isLanguageChangeFollowUp(...)`

## E. Source Grounding and RAG

### Source locations

EP1:

- `data/task1/static/raw/source_text.txt`
- `data/task1/static/processed/audio_transcript.txt`
- `data/task1/static/processed/image_descriptions.json`
- `data/task1/dynamic/processed/video_transcript.txt`
- `data/task1/dynamic/processed/scene_labels.json`
- Shared:
  - `data/task1/prompt.txt`
  - `data/task1/instruction.txt`
  - `data/task1/task.json`

EP2:

- `data/task2/static/raw/source_text.txt`
- `data/task2/static/processed/audio_transcript.txt`
- `data/task2/static/processed/image_descriptions.json`
- `data/task2/dynamic/processed/video_transcript.txt`
- `data/task2/dynamic/processed/scene_labels.json`
- Shared:
  - `data/task2/prompt.txt`
  - `data/task2/instruction.txt`
  - `data/task2/task.json`

### Loading

`backend/rag/loader.ts`:

- `getTaskConfig(taskId)`
- `loadTaskPackage(taskId, condition)`
- `buildCandidateDocuments(taskId, condition)`
- `dedupeDocuments(documents)`
- `buildVisualAssets(taskId, condition)`

### Chunking

`backend/rag/chunker.ts`:

- `MAX_CHUNK_LENGTH = 500`
- `OVERLAP_SENTENCES = 1`
- `chunkDocuments(taskId, documents)`

### Retrieval

`backend/rag/retriever.ts`:

- `retrieveTaskChunks(taskId, query, taskPackage, limit, allowFallback, memory)`
- `scoreChunk(...)`
- `sourceBoost(...)`
- `relevanceThreshold(...)`

Retrieval limit:

- `app/api/chat/route.ts`
- `retrievalLimit = requestClassification.requires_source_context ? 5 : 3`
- Because retrieval only runs when `requires_source_context` is true, practical top-k is normally 5.

### Retrieval query

`app/api/chat/route.ts`:

- `extractRetrievalQuery(query)`
- `buildRetrievalQuery(query, taskId, classification)`
- Adds aliases for `recognized_story_entity` from `STORY_ENTITY_REGISTRY`.

### Prompt insertion

`backend/rag/promptBuilder.ts`:

- If `includeSourceContext` is true, `buildUserInput(...)` inserts:
  - `<RETRIEVED_SOURCE_CONTEXT>`
  - `Retrieved ${materialLabel(taskPackage)}:`
  - selected chunk text

### Learner idea vs source fact

Prompt-level logic:

- `buildSystemInstruction(...)` says:
  - keep source facts, learner-created continuation, assistant suggestions, and current request separate
  - never present learner-created events as source facts
  - if retrieved story does not explicitly provide answer, say so and label interpretation

Routing-level logic:

- `classifyCurrentRequest(...)` tries to decide whether source context is required.
- `looksLikeSourceAlignmentRequest(...)` and `requiresStoryKnowledgeForRouting(...)` cause source retrieval.
- `contextPriority.ts` prevents some new current-language/current-idea requests from being treated as stale continuation follow-ups.

### Risk of source context overriding current request

Potential risk points:

- If `requires_source_context` is incorrectly set true, RAG may bring in source/table/character details that are unrelated to the current expression request.
- PromptBuilder now includes explicit priority lines, but the LLM can still overweight retrieved chunks if the prompt is complex.
- Entity aliases from prior memory may affect retrieval scoring through `scoreChunk(...)`.

## F. Policy Classification and Redirect

### Main classifier

File: `backend/policy/classifier.ts`

Entry points:

- `analyzeQueryScope(query)`
- `detectRestrictionReason(query)`
- `classifyQuery(query)`
- `asksForFullSentenceTranslation(query)`

Rule-based detection:

- Requested action:
  - `detectRequestedAction(query)`
- Target scope:
  - `detectTargetScope(query)`
- Output form:
  - `detectOutputForm(query, action, scope)`
- Support label:
  - `detectSupportModeLabel(query)`
- Feedback target:
  - `detectFeedbackTargetV2(query)`

Restricted reasons:

- `sentence_generation`
- `draft_rewrite`
- `outside_content`
- `direct_translation`
- `scoring_evaluation`

### Redirect response

File: `backend/policy/redirect.ts`

Key functions:

- `buildQueryAwareRedirect(reason, query, language)`
- `redirectResponse(reason, language, query)`
- `inferDirectTranslationPhrases(query)`
- `extractKoreanKeywordHints(target)`

Current direct-translation behavior:

- Whole sentence translation is redirected.
- Keywords are extracted first.
- A blank sentence frame is provided.

### Current request intent gate

File: `app/api/chat/route.ts`

Key functions:

- `classifyCurrentRequest(query, taskId, recentMessages, supportMode)`
- `looksLikeSourceAlignmentRequest(query)`
- `looksLikeGeneralLanguageQuestion(query)`
- `looksLikeContinuationFollowUp(query, recentMessages)`
- `isLanguageChangeFollowUp(query, recentMessages)`
- `acceptsPreviousEventSequenceOffer(query, recentMessages)`

### Task push logic

Locations:

- `backend/rag/promptBuilder.ts`
  - General prompt says task push is allowed only after answering the current question.
  - Allowed examples are listed in `buildSystemInstruction(...)`.
- `app/api/chat/route.ts`
  - `acceptsPreviousEventSequenceOffer(...)`
  - `buildAcceptedEventSequenceResponse(taskId)`
  - This can bypass OpenAI generation and return a deterministic event sequence for very short acceptance-like messages.

### Misclassification risks

Reviewers should inspect:

- `looksLikeContinuationFollowUp(...)`
  - If too broad, current expression requests can be treated as continuation planning.
- `isLanguageChangeFollowUp(...)`
  - If too broad, current text may be treated as a request to modify the previous assistant response.
- `hasExplicitAssistanceRequest(...)`
  - If it misses Korean intent phrases, the current request may be treated as draft-only or unclear.
- `looksLikeGeneralLanguageQuestion(...)`
  - If it misses "말하려고/이야기하려고" style phrasing, expression requests may be routed elsewhere.
- `acceptsPreviousEventSequenceOffer(...)`
  - If too broad, short messages may trigger a template response too early.

## G. Supabase

### Logger

File: `backend/logs/logger.ts`

Functions:

- `appendChatLog(entry)`
- `appendSessionTranscript(entry)`
- `insertIntoSupabase(table, payload)`
- `buildChatLogPayload(entry, useLegacyTaskId)`
- `buildSessionTranscriptPayload(entry, useLegacyTaskId)`

### Environment variable names

Defined/read in code:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_CHAT_EVENTS_TABLE`
- `SUPABASE_SESSION_TRANSCRIPTS_TABLE`

Used elsewhere:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_MS`
- `OPENAI_MAX_OUTPUT_TOKENS`

Actual values are not included in this document or review bundle.

### Tables

Schema and migrations:

- `docs/supabase-schema.sql`
- `docs/supabase-participant-id-migration.sql`
- `docs/supabase-chat-events-policy-fields-migration.sql`
- `docs/supabase-chat-events-review-view.sql`

Default table names:

- `chat_events`
- `session_transcripts`

### Main stored fields

`chat_events` includes:

- participant/session/episode/task identifiers
- selected category
- raw user query
- policy decision/reason
- status/response status
- assistant response
- retrieved chunk IDs and metadata
- timestamp
- interaction count
- session duration
- query/support labels
- source/visual metadata
- routing and classifier fields
- fallback state

`session_transcripts` includes:

- participant/session/episode/task identifiers
- condition
- timestamp
- interaction count
- session duration
- full transcript JSON

### Sensitive data warning

The local files below contain actual chat text and must not be included in external review bundles unless properly anonymized:

- `backend/logs/chat-log.jsonl`
- `backend/logs/session-transcripts.jsonl`

## H. Current Context Error: Potential Causes and Evidence

Observed issue:

The user wrote, in effect, that they wanted to express: "the message was left by a man living on Eighth Street who urgently needed a job." The chatbot instead returned to previous content about `leave the cafe`, checking `table 7`, Anna's action order, and a task push about adding a reason.

### Priority 1: Over-broad continuation follow-up detection

Code path:

- `app/api/chat/route.ts`
  - `classifyCurrentRequest(...)`
  - `looksLikeContinuationFollowUp(...)`
- Shared helper:
  - `backend/rag/contextPriority.ts`
  - `shouldTreatAsContinuationFollowUp(...)`

Evidence:

- The continuation follow-up path is checked before several other routing paths.
- Earlier logic treated recent continuation work plus a current message containing story-like fragments as enough to continue previous context.
- This can cause a new current expression request to be classified as `idea_generation` or `organization`, triggering source/RAG and previous task context.

Current mitigation present in source:

- `looksLikeNewCurrentLanguageIntent(...)` is intended to catch current expression requests such as `말하려고`, `이야기하려고`, `표현하려고`.
- `shouldTreatAsContinuationFollowUp(...)` now rejects such current-language requests.

Review need:

- Verify this guard covers the range of Korean learner phrasing used in the study.

### Priority 2: Prompt priority previously over-weighted recent history

Code path:

- `backend/rag/promptBuilder.ts`
  - `buildSystemInstruction(...)`
  - `buildUserInput(...)`

Evidence:

- The prompt includes large `RELEVANT_CHAT_HISTORY` and `Full participant-session memory`.
- Earlier prompt language treated recent conversation memory as part of the current question.
- If history mentions `leave the cafe` and `table 7`, the model may over-continue that line even when the current request changes topic.

Current mitigation present in source:

- The prompt now states:
  - "Answer the learner's most recent request directly."
  - "CURRENT_USER_REQUEST has priority over RELEVANT_CHAT_HISTORY."
  - "Do not continue correcting or explaining an earlier sentence unless CURRENT_USER_REQUEST explicitly refers to it."

Review need:

- Verify the final prompt section order and wording are strong enough.

### Priority 3: Current user intent can be missed by intent detectors

Code path:

- `app/api/chat/route.ts`
  - `looksLikeGeneralLanguageQuestion(...)`
  - `classifyCurrentRequest(...)`
- `backend/rag/promptBuilder.ts`
  - `detectSupportMode(...)`
- `backend/rag/conversationMemory.ts`
  - `inferExplicitSupportShift(...)`
  - `isContextualFollowUp`

Evidence:

- Korean phrases like `말하려고`, `이야기하려고`, and `표현하려고` are not the same as direct `영어로`/`번역` requests.
- If these are missed, the system may classify the turn as idea planning or continuation follow-up.

Current mitigation present in source:

- These terms are now included in language-intent detection in several locations.

Review need:

- Evaluate whether additional phrases such as `이런 설정으로 쓰려는데`, `이 내용을 넣고 싶어`, or `이렇게 말하고 싶은데` should also be explicit current-intent signals.

### Priority 4: RAG/source context can become irrelevant if retrieval is triggered by stale context

Code path:

- `app/api/chat/route.ts`
  - `requiresStoryKnowledgeForRouting(...)`
  - `buildRetrievalQuery(...)`
  - `retrieveTaskChunks(...)`
- `backend/rag/retriever.ts`
  - `scoreChunk(...)`

Evidence:

- Retrieval query may include entity aliases from recognized story entities.
- `scoreChunk(...)` also includes `memory.lastUserFocus` and active entities.
- If the current request is mistakenly routed as source/idea work, retrieved chunks can reinforce old source context.

Review need:

- Check whether retrieval should ignore memory for turns classified as current language support.

### Priority 5: Deterministic task-push/template response can fire too early

Code path:

- `app/api/chat/route.ts`
  - `acceptsPreviousEventSequenceOffer(...)`
  - `buildAcceptedEventSequenceResponse(taskId)`

Evidence:

- For short acceptance-like messages, this bypasses normal generation and returns a fixed event sequence.
- This is useful for "응 잡아줘" style messages, but risky if acceptance detection is too broad.

Review need:

- Confirm it only triggers on genuinely short acceptance messages and not on longer new intent messages.

### Other checked possibilities

- **Recent user message missing/truncated**
  - Frontend sends current `query` separately, so current input is not dependent on `recentMessages`.
  - Prompt includes `<CURRENT_USER_REQUEST>`.
  - Risk remains if `splitLearnerDraftAndRequest(...)` extracts the wrong current request from multiline input.

- **Conversation history order**
  - `recentMessages` are sent in chronological UI order from the active task state.
  - `buildRecentSummary(...)` uses `slice(-12)`, preserving order.

- **EP/task stale state**
  - Frontend maintains separate `taskStates` per task.
  - API derives `epId` from `taskId`.
  - Risk remains if localStorage rehydration or selectedTask state is inconsistent with the UI.

- **Fixed response template reuse**
  - Main deterministic templates are redirect responses and accepted event sequence responses.
  - Regular OpenAI generation does not use a fixed response template, but prompt instructions can still bias sectioned responses.

## Review File Inventory

| Path | Role | Relevance to context error | Required for external review |
|---|---|---|---|
| `package.json` | Dependencies and scripts | Shows Next/OpenAI versions and test commands | Yes |
| `package-lock.json` | Locked dependency graph | Reproducibility | Yes |
| `tsconfig.json` | TypeScript/path config | Explains `@/*` imports | Yes |
| `next.config.ts` | Next configuration | Runtime/build context | Yes |
| `app/page.tsx` | Chat UI, task state, message submission, streaming display | Sends `recentMessages` and current `query`; task/episode separation | Yes |
| `app/layout.tsx` | App shell metadata | Low context relevance | No |
| `app/globals.css` | Styling | Not relevant to response logic | No |
| `app/api/chat/route.ts` | Main chat API route, routing, OpenAI calls, retrieval gate, logging | Central file for current context bug | Yes |
| `app/api/session/route.ts` | Session transcript persistence | Episode/session transcript logging | Yes |
| `app/api/ingest/route.ts` | Ingest/status stub | Source readiness, not central | Yes |
| `backend/rag/promptBuilder.ts` | System prompt and final user/context prompt assembly | Priority between current request, history, source context | Yes |
| `backend/rag/conversationMemory.ts` | Recent/full history summarization and contextual follow-up state | Potential stale context source | Yes |
| `backend/rag/contextPriority.ts` | Current-intent vs continuation-follow-up priority rules | Directly relevant to reported bug | Yes |
| `backend/rag/loader.ts` | EP/task source loading | EP1/EP2 source separation | Yes |
| `backend/rag/retriever.ts` | Chunk scoring/retrieval | RAG context could reinforce stale topic | Yes |
| `backend/rag/chunker.ts` | Source chunking | RAG chunk boundaries/top-k context | Yes |
| `backend/rag/lexicon.ts` | Entity/term expansion | Active entities and retrieval scoring | Yes |
| `backend/rag/assetResolver.ts` | Visual input resolution | May affect multimodal context | Yes |
| `backend/policy/classifier.ts` | Allowed/restricted query classifier | Misclassification risk | Yes |
| `backend/policy/redirect.ts` | Redirect scaffolds | Restricted response behavior | Yes |
| `backend/logs/logger.ts` | Supabase/local logging | Stored fields, Supabase client use | Yes |
| `docs/supabase-schema.sql` | Base schema | Logging schema | Yes |
| `docs/supabase-participant-id-migration.sql` | Participant ID migration | Logging schema evolution | Yes |
| `docs/supabase-chat-events-policy-fields-migration.sql` | Policy/routing logging fields | Review of diagnostics | Yes |
| `docs/supabase-chat-events-review-view.sql` | Research review view | Review table view | Yes |
| `docs/deployment-logging.md` | Env var names and logging setup | Useful for env names without secrets | Yes |
| `data/task1/task.json` | EP1 config | Task config | Yes |
| `data/task1/prompt.txt` | EP1 task prompt | Task instruction context | Yes |
| `data/task1/instruction.txt` | EP1 instruction | Task instruction context | Yes |
| `data/task1/source_text.txt` | EP1 source text copy | Source grounding review | Yes |
| `data/task1/static/raw/source_text.txt` | EP1 static source | Static RAG source | Yes |
| `data/task1/static/processed/audio_transcript.txt` | EP1 static audio transcript | Static RAG source | Yes |
| `data/task1/dynamic/processed/video_transcript.txt` | EP1 dynamic transcript | Dynamic RAG source | Yes |
| `data/task1/static/processed/image_descriptions.json` | EP1 image descriptions | Static visual/source context without images | Yes |
| `data/task1/dynamic/processed/scene_labels.json` | EP1 scene labels | Dynamic visual/source context without video | Yes |
| `data/task1/task1-lexicon.json` | EP1 lexicon | Retrieval/entity expansion | Yes |
| `data/task1/task1-lexicon-source.json` | EP1 lexicon source | Retrieval/entity expansion provenance | Yes |
| `data/task2/task.json` | EP2 config | Task config | Yes |
| `data/task2/prompt.txt` | EP2 task prompt | Task instruction context | Yes |
| `data/task2/instruction.txt` | EP2 instruction | Task instruction context | Yes |
| `data/task2/source_text.txt` | EP2 source text copy | Source grounding review | Yes |
| `data/task2/static/raw/source_text.txt` | EP2 static source | Static RAG source | Yes |
| `data/task2/static/processed/audio_transcript.txt` | EP2 static audio transcript | Static RAG source | Yes |
| `data/task2/dynamic/processed/video_transcript.txt` | EP2 dynamic transcript | Dynamic RAG source | Yes |
| `data/task2/static/processed/image_descriptions.json` | EP2 image descriptions | Static visual/source context without images | Yes |
| `data/task2/dynamic/processed/scene_labels.json` | EP2 scene labels | Dynamic visual/source context without video | Yes |
| `data/task2/task2-lexicon.json` | EP2 lexicon | Retrieval/entity expansion | Yes |
| `data/task2/task2-lexicon-source.json` | EP2 lexicon source | Retrieval/entity expansion provenance | Yes |
| `prompts/system/masterSystemPrompt.txt` | Reference/legacy system prompt | Policy reference; not directly imported by chat route | Yes |
| `prompts/system/policyPrompt.txt` | Reference/legacy policy prompt | Policy reference; not directly imported by chat route | Yes |
| `prompts/system/categoryPrompt.txt` | Reference/legacy category prompt | Classification reference | Yes |
| `prompts/task/task1_static.txt` | Reference task prompt | EP1 reference | Yes |
| `prompts/task/task1_dynamic.txt` | Reference task prompt | EP1 dynamic reference | Yes |
| `scripts/policy-regression-tests.mjs` | Policy regression tests | Classifier/redirect behavior | Yes |
| `scripts/context-priority-tests.mjs` | Context priority regression tests | Directly tests reported bug class | Yes |
| `scripts/build-lexicons.mjs` | Lexicon build utility | Source of retrieval lexicons | Yes |
| `README.md` | Setup and usage | Env var names and policy overview | Yes |
| `.env.example` | Env names only | Not present in repository | No |
| `backend/logs/chat-log.jsonl` | Local raw chat logs | Contains participant prompt/response data | No; exclude |
| `backend/logs/session-transcripts.jsonl` | Local raw transcripts | Contains participant prompt/response data | No; exclude |
| `data/**/raw/images/*`, `*.mp3`, `*.mp4`, keyframes | Large media/source assets | Not required for code-level logic review; may be large | No; exclude |
| `.env.local` | Actual local secrets | Contains secret values | No; exclude |

## Bundle Notes

The review bundle should include only code, small text source/config files, schema/migrations, tests, and this handoff. It must exclude secrets, build output, local logs, node modules, Git history, and large media assets.
