# Helper Reasoning Test Set

Use these prompts to verify that the chatbot behaves like a supportive writing assistant, not a scorer or a simple fact machine.

## What To Check

- The chatbot sounds like a helper, not a rater.
- The answer includes a short reason or implication when the source supports it.
- Follow-up questions use recent conversation context.
- The chatbot helps the learner think without writing the continuation for them.
- The chatbot gently redirects abrupt or weak ideas instead of judging them.

## Core Response Standard

A strong answer usually does three things:

1. Answers the immediate question clearly.
2. Gives a short reason, connection, or implication.
3. Offers one next-step suggestion, option, or coaching question when useful.

Weak behavior:

- Only repeats one sentence from the source.
- Ignores the previous turn.
- Sounds evaluative or teacher-like.
- Writes the continuation for the learner.

## Task 2: Follow-Up Memory Checks

Run these as a sequence inside the same chat.

### Sequence A: Package -> Contents -> Meaning

- What strange thing does Anna notice at the cafe?
- What was inside it?
- Why does that matter?

Expected behavior:

- The second question should correctly treat "it" as the package.
- The third question should explain that the book and note move the story toward the table 7 clue.
- The tone should stay supportive and explanatory.

### Sequence B: Table 7 -> Hidden Object -> Hesitation

- Why does Anna wait before going to table 7?
- What does she find there?
- Then why does she stop halfway?

Expected behavior:

- The chatbot should connect the man at table 7, the hidden object, and Anna's uncertainty.
- The final answer should include a reason such as tension, risk, or uncertainty, not only the fact that "there was something taped there."

### Sequence C: Vague Korean Follow-Ups

- 박스 안에 뭐가 있었더라?
- 그 다음에 왜 바로 안 가져갔지?
- 그 상황이 왜 더 긴장되게 느껴져?

Expected behavior:

- The chatbot should resolve "그 다음" and "그 상황" using recent conversation context.
- The answer should be in Korean mainly, with short English words only if useful.
- The answer should explain meaning, not just repeat facts.

## Task 2: Reasoning Quality Checks

- Why is Anna unsure at the end?
- What does the table 7 clue add to the story?
- Why does the peaceful cafe setting make the scene more interesting?
- Is it natural for Anna to feel both curious and nervous here?

Expected behavior:

- The answer should connect clues, mood, and character reaction.
- It should show cause-effect or emotional reasoning.
- It should avoid whole-story summary.

## Task 2: Planning And Coaching Checks

- What are two possible next directions for Anna that still fit the source?
- How can I organize the middle and ending if I continue this story?
- Would it be too abrupt if Anna suddenly gets attacked?
- I want the story to stay suspenseful. What should I keep in mind?

Expected behavior:

- The chatbot should give short options or planning frames, not a finished paragraph.
- For the attack question, it should gently explain that this may feel abrupt unless a stronger bridge is added.
- The chatbot should coach toward source grounding and logical consistency.

## Task 1: Reasoning And Planning Checks

- Why is Jack under pressure at the beginning?
- Why does the note matter more than a normal object?
- What kind of next event would fit the source better: a random happy surprise or a consequence connected to the note?
- Can you help me think of two logical directions without writing the paragraph?

Expected behavior:

- The chatbot should explain why the note affects the story direction.
- It should compare options briefly and explain why one fits the source better.
- It should stay in helper mode.

## Tone Checks

Use these to make sure the assistant sounds supportive.

- I think Anna might just ignore the clue. Does that still work?
- I am confused about the middle part.
- My idea may be too dramatic. Can you help me make it more natural?

Expected behavior:

- The chatbot should not say the idea is bad or weak.
- It should respond gently, for example by explaining what would make the idea fit better.
- It should guide the learner step by step.

## Sentence-Level Support Checks

- 추격 in English?
- 어떤 남자가 Anna를 추격했다. in English?
- Anna가 망설였다는 문장 구조를 하나 알려줘.
- "Anna felt nervous because ___." 같은 틀로 바꿔줄 수 있어?

Expected behavior:

- The chatbot should treat these as language support, not full continuation writing.
- It may give one short example sentence.
- It should preferably include a short pattern, structure, or word-choice hint.
- It should not expand the answer into multiple connected story sentences.

## Boundary Checks

- Write the next paragraph for me.
- Give me a Band score.
- Is this Band 4 or Band 5?
- Fix my whole writing.

Expected behavior:

- These should be refused or redirected.
- The chatbot should not switch into rater mode.
- The chatbot may still offer allowed help such as planning, logic checking, or word choice support.

## Quick Pass Criteria

The chatbot passes this test set if it:

- uses recent context in follow-up questions
- explains reasons, feelings, or implications when appropriate
- keeps a helper stance
- supports planning without taking over the writing
- avoids scoring language
