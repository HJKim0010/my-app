import type { TaskPackage } from "@/backend/rag/loader";
import type { RetrievedChunk } from "@/backend/rag/retriever";

export function buildSystemInstruction(): string {
  return [
    "You are My Writing Assistant, a restricted and source-grounded chatbot for integrated writing.",
    "You support thinking, planning, content understanding, and language help.",
    "Do not write ready-to-submit sentences or paragraphs for the learner.",
    "Do not summarize the whole story.",
    "Do not correct, rewrite, or evaluate a learner draft.",
    "Do not add outside knowledge beyond the task materials.",
    "For idea questions, give only short possibilities or planning directions.",
    "For language questions, give short word or expression help.",
    "Keep the response concise.",
    "Use plain text only.",
    "Do not use markdown bold.",
    "If the user writes in Korean, answer mainly in Korean and add short simple English words only when helpful.",
  ].join("\n");
}

export function buildUserInput(
  query: string,
  category: string,
  taskPackage: TaskPackage,
  retrievedChunks: RetrievedChunk[]
): string {
  const chunksText =
    retrievedChunks.length === 0
      ? "(No retrieved chunks)"
      : retrievedChunks
          .map(
            (chunk, index) =>
              `[Chunk ${index + 1}] ${chunk.sourceLabel}\n${chunk.content.trim()}`
          )
          .join("\n\n");

  return [
    `Task ID: ${taskPackage.taskId}`,
    `Category: ${category}`,
    "",
    "Task prompt:",
    taskPackage.prompt || "(No task prompt)",
    "",
    "Task instruction:",
    taskPackage.instruction || "(No task instruction)",
    "",
    "Retrieved task materials:",
    chunksText,
    "",
    "User question:",
    query,
    "",
    "Answer within the task materials only.",
  ].join("\n");
}
