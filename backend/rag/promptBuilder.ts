import fs from "node:fs";
import path from "node:path";
import type { TaskPackage } from "@/backend/rag/loader";
import type { RetrievedChunk } from "@/backend/rag/retriever";

const PROMPTS_ROOT = path.join(process.cwd(), "prompts");

function readPromptFile(fullPath: string, fallback: string): string {

  if (!fs.existsSync(fullPath)) {
    return fallback;
  }

  return fs.readFileSync(fullPath, "utf8").trim() || fallback;
}

export function buildSystemInstruction(): string {
  const master = readPromptFile(
    path.join(PROMPTS_ROOT, "system", "masterSystemPrompt.txt"),
    "You are a restricted, source-grounded writing support chatbot."
  );
  const policy = readPromptFile(path.join(PROMPTS_ROOT, "system", "policyPrompt.txt"), "");
  const category = readPromptFile(path.join(PROMPTS_ROOT, "system", "categoryPrompt.txt"), "");

  return [master, policy, category].filter(Boolean).join(" ");
}

export function buildUserInput(
  query: string,
  category: string,
  taskPackage: TaskPackage,
  retrievedChunks: RetrievedChunk[]
): string {
  const contextBlock =
    retrievedChunks.length > 0
      ? retrievedChunks
          .map(
            (chunk) =>
              `[${chunk.chunkId}] ${chunk.sourceLabel} (${chunk.sourceType})\n${chunk.content}`
          )
          .join("\n\n")
      : "No relevant Task1 chunks were retrieved.";

  const visualSummary =
    taskPackage.visualAssets.length > 0
      ? taskPackage.visualAssets.map((asset) => `${asset.label} (${asset.kind})`).join(", ")
      : "No direct visual assets are currently loaded for this session.";

  return [
    `Task ID: ${taskPackage.config.task_id}`,
    `Task Title: ${taskPackage.config.title}`,
    `Condition: ${taskPackage.conditionLabel}`,
    `Category: ${category}`,
    "",
    "Learner-facing task prompt:",
    taskPackage.prompt || "[Prompt placeholder is still empty.]",
    "",
    "Learner-facing task instruction:",
    taskPackage.instruction || "[Instruction placeholder is still empty.]",
    "",
    "Retrieved session materials:",
    contextBlock,
    "",
    `Loaded visual assets: ${visualSummary}`,
    "",
    `User query: ${query}`,
    "",
    "Respond within policy limits. Use only assigned session materials. Prefer bullet points, outline guidance, vocabulary help, local clarification, or abstract frames with blanks.",
  ].join("\n");
}
