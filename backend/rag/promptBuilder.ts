import fs from "node:fs";
import path from "node:path";
import type { TaskPackage } from "@/backend/rag/loader";
import type { RetrievedChunk } from "@/backend/rag/retriever";

const PROMPTS_ROOT = path.join(process.cwd(), "prompts");
const CONFUSION_PATTERNS = [
  "i don't understand",
  "i do not understand",
  "i am confused",
  "i'm confused",
  "this is hard",
  "i'm lost",
  "i am lost",
  "i don't get it",
  "i do not get it",
  "what does this mean",
  "무슨 뜻",
  "이해가 안",
  "헷갈",
  "어려워",
  "기억이 안 나",
  "기억이 안나",
  "잘 모르겠",
];

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

function isConfusionQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return CONFUSION_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function buildUserInput(
  query: string,
  category: string,
  taskPackage: TaskPackage,
  retrievedChunks: RetrievedChunk[]
): string {
  const confusionSupportInstruction = isConfusionQuery(query)
    ? "The learner sounds confused. Give scaffolding only. Explain one small part at a time in simple Korean, add only 1 to 3 easy English words or short phrases, and stop there. Do not move on to writing plans, paragraph ideas, outlines, or continuation support unless the learner asks again."
    : "If the learner asks for source understanding, explain locally and briefly before offering any other kind of support.";

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
    "Respond within policy limits. Use only assigned session materials. Keep the response short. Use plain text only. Do not use markdown or bold markers. Prefer at most 3 short bullet points or 2 short sentences. If the learner asks in Korean, explain mainly in Korean and include 1 to 3 easy English words or short phrases when helpful.",
    confusionSupportInstruction,
  ].join("\n");
}
