# My Writing Assistant

EFL continuation writing research를 위한 제한형 AI 챗봇입니다. 이 챗봇은 학습자의 글을 대신 써주는 도구가 아니라, 주어진 자료를 바탕으로 이야기 이해, 아이디어 탐색, 글 구성, 표현 선택을 돕는 보조 도구입니다.

This is a restricted, source-grounded AI chatbot for an EFL continuation writing experiment. It supports learners' thinking and planning, but it must not write the continuation for them.

## 주요 기능

- EP1, EP2 과제별 독립 대화 세션
- 한국어와 영어 질문 모두 지원
- 이야기 이해, 단서 확인, 다음 사건 아이디어, 구성 계획, 표현 도움 제공
- 참여자 ID 기반 로컬 세션 저장
- Supabase 환경 변수가 있으면 연구 로그를 Supabase에 저장
- Supabase 설정이 없으면 개발 중 로컬 JSONL 로그로 대체

## 이렇게 물어보세요

챗봇은 글을 대신 써주지 않습니다. 대신, 여러분이 직접 글을 쓸 수 있도록 아래 네 가지 방식으로 도와줍니다.

- 이야기 이해: "다음 부분을 위해 중요한 단서는 무엇인가요?"
- 아이디어 얻기: "그 단서를 사용한 다음 사건 2가지를 생각해 볼 수 있나요?"
- 구성 도움: "단서, 생각, 행동, 결과를 어떤 순서로 정리하면 좋을까요?"
- 표현 도움: "이 생각을 표현할 때 쓸 수 있는 문장 패턴은 무엇인가요?"

Ask for story understanding, idea support, organization support, or expression patterns.

## 이렇게 묻지 마세요

다음 요청은 글을 대신 써주는 것에 가까우므로 제한됩니다.

- "다음 문단을 써 줘."
- "결말을 대신 써 줘."
- "내 문단을 다시 써 줘."
- "이 문장을 영어로 번역해 줘."

For Korean-to-English sentence or phrase requests, the chatbot may give direct local English options with a short nuance or grammar note, but it must not turn that help into a full continuation paragraph or model answer.

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

로컬 실행을 위해 프로젝트 루트에 `.env.local` 파일을 만들고 필요한 값을 설정합니다.

```bash
OPENAI_API_KEY=your_openai_api_key
```

Supabase 로그 저장을 사용할 경우 아래 값도 함께 설정합니다.

```bash
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_CHAT_EVENTS_TABLE=chat_events
SUPABASE_SESSION_TRANSCRIPTS_TABLE=session_transcripts
```

Supabase 테이블은 `docs/supabase-schema.sql`을 Supabase SQL editor에서 실행해 만들 수 있습니다. 자세한 내용은 `docs/deployment-logging.md`를 확인하세요.

### 3. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

## 연구 참여자 사용 흐름

1. 참여자 ID를 입력합니다. 예: `P01`, `P02`
2. EP1 또는 EP2 과제를 선택합니다.
3. 시작 전 안내문을 읽고 확인합니다.
4. 챗봇에게 필요한 도움을 질문합니다.
5. 최종 글은 참여자가 직접 작성합니다.

## 배포

이 프로젝트는 Next.js 앱이므로 Vercel 배포를 사용할 수 있습니다.

배포 환경에서도 `.env.local`에 넣은 값과 동일한 환경 변수를 Vercel Project Settings에 설정해야 합니다.

## 개발 참고 문서

- `docs/engineering-spec-v2.md`: 챗봇 설계 원칙과 기능 범위
- `docs/helper-reasoning-test-set.md`: helper stance 테스트 프롬프트
- `docs/task-check-questions.md`: 과제별 확인 질문
- `docs/deployment-logging.md`: Supabase 로그 저장 설정
- `docs/asset-prep-guide.md`: 과제 자료 준비 가이드

## 핵심 원칙

AI는 학습자의 생각을 돕고, 글은 학습자가 직접 씁니다.

The AI supports thinking. The learner writes the continuation.
