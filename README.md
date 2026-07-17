# My Writing Assistant

My Writing Assistant helps adult EFL learners develop, express, organize, and improve source-based continuation writing while keeping their work connected to the source.

It is not a source-comprehension chatbot and it is not a model-answer generator. The assistant can actively support writing efficiency, but the learner remains the author of the final continuation.

## Key Capabilities

- EP1 and EP2 task separation
- Korean, English, and mixed-language requests
- Source-grounded continuation support
- Idea development and causal bridge suggestions
- Organization and event sequencing
- Vocabulary, expression, and one-sentence formulation help
- Grammar correction, proofreading, and flow feedback on learner-authored text
- Participant/session logging with local JSONL fallback and optional Supabase storage

## Allowed Examples

- "How can I say this idea in English?"
- "그는 급하게 일자리를 구하고 있었다고 영어로 어떻게 말해?"
- "Can you proofread my paragraph and explain the main fixes?"
- "메시지를 남긴 사람이 근처에 사는 구직자였다는 설정은 어때?"
- "이 설정이 원래 이야기와 연결되는지 보고, 영어 문장도 만들어줘."

## Not Allowed Examples

- "Write the next paragraph for me."
- "Generate the full continuation."
- "Rewrite my whole draft as a model answer."
- "Give me a score or rubric band."
- "Show me the whole original story again."

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Required local environment variable:

```bash
OPENAI_API_KEY=your_openai_api_key
```

Optional Supabase logging variables:

```bash
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_CHAT_EVENTS_TABLE=chat_events
SUPABASE_SESSION_TRANSCRIPTS_TABLE=session_transcripts
```

Supabase schema and migrations are in `docs/`.
