# Hybrid Multimodal RAG Chatbot Engineering Spec V2

Task 1 pilot uses a restricted, source-grounded, session-isolated chatbot for continuation writing support.

- Static condition: source text, images, checked audio transcript, optional audio metadata
- Dynamic condition: captioned video transcript, timestamps, scene segmentation, selected keyframes
- All outputs must remain grounded in session materials only
- The chatbot must support idea generation, planning, local clarification, and vocabulary help only
- The chatbot must not generate continuation content for the learner
