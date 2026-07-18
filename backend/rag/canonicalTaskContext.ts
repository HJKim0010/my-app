import type { TaskDocument, TaskPackage } from "@/backend/rag/loader";

export type CanonicalTaskContext = {
  id: string;
  text: string;
  approxChars: number;
  included: boolean;
};

const TASK_FACTS = {
  task1: [
    "Episode: EP1 / Jack's story.",
    "Protagonist: Jack.",
    "Jack is a student. The story context suggests a university student.",
    "Jack is in a hurry because an important presentation affects his final grade and possibly graduation.",
    "Jack's team depends on him.",
    "Jack forgot or left behind his wallet and student ID. Do not say he lost them unless the learner writes that as a continuation idea.",
    "Jack already has his bag and laptop. The source also mentions clothes.",
    "A woman/stranger appears. Her identity and intention are not confirmed in the source.",
    "No cafe role is stated for Jack. If asked whether Jack worked at a cafe, correct that as unsupported by the source.",
  ],
  task2: [
    "Episode: EP2 / Anna's story.",
    "Protagonist: Anna.",
    "Anna went to a cafe after a long study session.",
    "The package/box contained a thin black book and a folded note.",
    "The note told Anna to look under table 7.",
    "The exact identity of the object taped under table 7 is not confirmed in the source.",
    "The man's identity and connection to the package are not confirmed in the source.",
    "The source does not say that Anna called the police unless the learner adds that as a continuation idea.",
  ],
} as const;

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function documentPriority(document: TaskDocument): number {
  switch (document.sourceType) {
    case "source_text":
    case "video_transcript":
      return 1;
    case "audio_transcript":
      return 2;
    case "image_description":
    case "scene_labels":
      return 3;
    case "prompt":
      return 4;
    case "instruction":
      return 5;
    default:
      return 9;
  }
}

function formatDocument(document: TaskDocument): string {
  return [
    `## ${document.label}`,
    `source_type: ${document.sourceType}`,
    document.content.trim(),
  ].join("\n");
}

export function buildCanonicalTaskContext(taskPackage: TaskPackage): CanonicalTaskContext {
  const orderedDocuments = [...taskPackage.documents]
    .filter((document) => compactText(document.content).length > 0)
    .sort((a, b) => documentPriority(a) - documentPriority(b));
  const taskFacts = TASK_FACTS[taskPackage.taskId];
  const id = `${taskPackage.taskId}:${taskPackage.condition}:canonical-v1`;
  const body = [
    "<CANONICAL_TASK_CONTEXT>",
    `context_id: ${id}`,
    `task_id: ${taskPackage.taskId}`,
    `condition: ${taskPackage.condition}`,
    `condition_label: ${taskPackage.conditionLabel}`,
    "",
    "Use this as stable reference context for the active episode only. Do not import facts from the other episode or another condition.",
    "Keep source facts, plausible interpretations, and learner-generated continuation ideas separate.",
    "If a fact is not in this context, say the source does not state it before offering a possible continuation interpretation.",
    "",
    "## Established Facts",
    ...taskFacts.map((fact) => `- ${fact}`),
    "",
    "## Task Prompt",
    taskPackage.prompt.trim() || "(No task prompt loaded.)",
    "",
    "## Task Instructions",
    taskPackage.instruction.trim() || "(No task instruction loaded.)",
    "",
    "## Active Episode Materials",
    ...orderedDocuments
      .filter((document) => document.sourceType !== "prompt" && document.sourceType !== "instruction")
      .map(formatDocument),
    "</CANONICAL_TASK_CONTEXT>",
  ].join("\n");

  return {
    id,
    text: body,
    approxChars: body.length,
    included: orderedDocuments.length > 0 || Boolean(taskPackage.prompt || taskPackage.instruction),
  };
}
