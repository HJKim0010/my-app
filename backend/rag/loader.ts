import fs from "node:fs";
import path from "node:path";

export type TaskId = "task1" | "task2";
export type TaskCondition = "static" | "dynamic";

export type TaskConditionConfig = {
  condition_label: string;
  retrieval_enabled: boolean;
  allowed_sources: string[];
};

export type TaskConfig = {
  task_id: string;
  title: string;
  language: string;
  source_type: string;
  ai_condition: string;
  default_condition: TaskCondition;
  conditions: Record<TaskCondition, TaskConditionConfig>;
};

export type TaskDocument = {
  id: string;
  sourceType: string;
  label: string;
  content: string;
  filePath: string;
};

export type VisualAsset = {
  id: string;
  kind: "image" | "keyframe";
  label: string;
  filePath: string;
};

export type TaskPackage = {
  config: TaskConfig;
  taskId: TaskId;
  condition: TaskCondition;
  conditionLabel: string;
  documents: TaskDocument[];
  prompt: string;
  instruction: string;
  visualAssets: VisualAsset[];
};

function getTaskRoot(taskId: TaskId): string {
  return path.join(process.cwd(), "data", taskId);
}

function taskTitle(taskId: TaskId): string {
  return taskId === "task2" ? "Task 2" : "Task 1";
}

function isPlaceholderText(text: string): boolean {
  const normalized = text.trim();
  return !normalized || normalized.startsWith("[TODO]");
}

function readTextFile(fullPath: string): string {
  if (!fs.existsSync(fullPath)) {
    return "";
  }

  return fs.readFileSync(fullPath, "utf8").trim();
}

function readJsonFile<T>(fullPath: string, fallback: T): T {
  if (!fs.existsSync(fullPath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as T;
}

function listFiles(dirPath: string, extensions: string[]): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((name) => extensions.some((extension) => name.toLowerCase().endsWith(extension)))
    .map((name) => path.join(dirPath, name))
    .sort();
}

function normalizeForDedup(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function getTaskConfig(taskId: TaskId): TaskConfig {
  const taskRoot = getTaskRoot(taskId);
  const configPath = path.join(taskRoot, "task.json");

  return readJsonFile<TaskConfig>(configPath, {
    task_id: taskId,
    title: taskTitle(taskId),
    language: "en",
    source_type: "multimodal",
    ai_condition: "restricted_source_grounded_bounded_support",
    default_condition: "static",
    conditions: {
      static: {
        condition_label: "static_multimodal_condition",
        retrieval_enabled: true,
        allowed_sources: ["source_text", "audio_transcript", "image_description", "prompt", "instruction"],
      },
      dynamic: {
        condition_label: "dynamic_multimodal_condition",
        retrieval_enabled: true,
        allowed_sources: ["video_transcript", "scene_labels", "prompt", "instruction"],
      },
    },
  });
}

function buildCandidateDocuments(taskId: TaskId, condition: TaskCondition): TaskDocument[] {
  const taskRoot = getTaskRoot(taskId);
  const staticRoot = path.join(taskRoot, "static");
  const dynamicRoot = path.join(taskRoot, "dynamic");
  const staticSourceText = readTextFile(path.join(staticRoot, "raw", "source_text.txt"));
  const staticAudioTranscript = readTextFile(path.join(staticRoot, "processed", "audio_transcript.txt"));
  const dynamicVideoTranscript = readTextFile(path.join(dynamicRoot, "processed", "video_transcript.txt"));

  const imageDescriptions = readJsonFile<{ images?: Array<{ id?: string; description?: string; label?: string }> }>(
    path.join(staticRoot, "processed", "image_descriptions.json"),
    {}
  );
  const sceneLabels = readJsonFile<{ scene_labels?: Array<{ id?: string; label?: string; description?: string }> }>(
    path.join(dynamicRoot, "processed", "scene_labels.json"),
    {}
  );

  const sharedPrompt = readTextFile(path.join(taskRoot, "prompt.txt"));
  const sharedInstruction = readTextFile(path.join(taskRoot, "instruction.txt"));

  const candidates: Record<TaskCondition, TaskDocument[]> = {
    static: [
      {
        id: "source_text",
        sourceType: "source_text",
        label: "Source Text",
        content: isPlaceholderText(staticSourceText) ? dynamicVideoTranscript : staticSourceText,
        filePath: path.join(staticRoot, "raw", "source_text.txt"),
      },
      {
        id: "audio_transcript",
        sourceType: "audio_transcript",
        label: "Audio Transcript",
        content: isPlaceholderText(staticAudioTranscript) ? dynamicVideoTranscript : staticAudioTranscript,
        filePath: path.join(staticRoot, "processed", "audio_transcript.txt"),
      },
      {
        id: "image_description",
        sourceType: "image_description",
        label: "Image Description",
        content: (imageDescriptions.images || [])
          .map((item, index) => `${item.label || item.id || `image_${index + 1}`}: ${item.description || ""}`.trim())
          .join("\n\n"),
        filePath: path.join(staticRoot, "processed", "image_descriptions.json"),
      },
      {
        id: "prompt",
        sourceType: "prompt",
        label: "Task Prompt",
        content: sharedPrompt,
        filePath: path.join(taskRoot, "prompt.txt"),
      },
      {
        id: "instruction",
        sourceType: "instruction",
        label: "Task Instruction",
        content: sharedInstruction,
        filePath: path.join(taskRoot, "instruction.txt"),
      },
    ],
    dynamic: [
      {
        id: "video_transcript",
        sourceType: "video_transcript",
        label: "Video Transcript",
        content: isPlaceholderText(dynamicVideoTranscript) ? staticSourceText : dynamicVideoTranscript,
        filePath: path.join(dynamicRoot, "processed", "video_transcript.txt"),
      },
      {
        id: "scene_labels",
        sourceType: "scene_labels",
        label: "Scene Labels",
        content: (sceneLabels.scene_labels || [])
          .map((item, index) => `${item.label || item.id || `scene_${index + 1}`}: ${item.description || ""}`.trim())
          .join("\n\n"),
        filePath: path.join(dynamicRoot, "processed", "scene_labels.json"),
      },
      {
        id: "prompt",
        sourceType: "prompt",
        label: "Task Prompt",
        content: sharedPrompt,
        filePath: path.join(taskRoot, "prompt.txt"),
      },
      {
        id: "instruction",
        sourceType: "instruction",
        label: "Task Instruction",
        content: sharedInstruction,
        filePath: path.join(taskRoot, "instruction.txt"),
      },
    ],
  };

  return candidates[condition];
}

function dedupeDocuments(documents: TaskDocument[]): TaskDocument[] {
  const seen = new Set<string>();
  const deduped: TaskDocument[] = [];

  for (const document of documents) {
    const normalized = normalizeForDedup(document.content);

    if (!normalized) {
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(document);
  }

  return deduped;
}

function buildVisualAssets(taskId: TaskId, condition: TaskCondition): VisualAsset[] {
  const taskRoot = getTaskRoot(taskId);
  const staticImages = listFiles(path.join(taskRoot, "static", "raw", "images"), [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
  ]).map((filePath, index) => ({
    id: `static_image_${index + 1}`,
    kind: "image" as const,
    label: `Static image ${index + 1}`,
    filePath,
  }));

  const dynamicKeyframes = listFiles(path.join(taskRoot, "dynamic", "processed", "keyframes"), [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
  ]).map((filePath, index) => ({
    id: `dynamic_keyframe_${index + 1}`,
    kind: "keyframe" as const,
    label: `Dynamic keyframe ${index + 1}`,
    filePath,
  }));

  return condition === "static" ? staticImages : dynamicKeyframes;
}

export function loadTaskPackage(taskId: TaskId, condition?: TaskCondition): TaskPackage {
  const taskRoot = getTaskRoot(taskId);
  const config = getTaskConfig(taskId);
  const resolvedCondition = condition || config.default_condition;
  const conditionConfig = config.conditions[resolvedCondition];
  const documents = dedupeDocuments(
    buildCandidateDocuments(taskId, resolvedCondition).filter((candidate) =>
      conditionConfig.allowed_sources.includes(candidate.id)
    )
  );

  return {
    config,
    taskId,
    condition: resolvedCondition,
    conditionLabel: conditionConfig.condition_label,
    documents,
    prompt: readTextFile(path.join(taskRoot, "prompt.txt")),
    instruction: readTextFile(path.join(taskRoot, "instruction.txt")),
    visualAssets: buildVisualAssets(taskId, resolvedCondition),
  };
}

export function getTaskSessionStatus(taskId: TaskId) {
  const taskRoot = getTaskRoot(taskId);

  return {
    task_root: taskRoot,
    static: {
      source_text: fs.existsSync(path.join(taskRoot, "static", "raw", "source_text.txt")),
      audio_transcript: fs.existsSync(path.join(taskRoot, "static", "processed", "audio_transcript.txt")),
      images: listFiles(path.join(taskRoot, "static", "raw", "images"), [".png", ".jpg", ".jpeg", ".webp"]).length,
    },
    dynamic: {
      video_transcript: fs.existsSync(path.join(taskRoot, "dynamic", "processed", "video_transcript.txt")),
      scene_labels: fs.existsSync(path.join(taskRoot, "dynamic", "processed", "scene_labels.json")),
      keyframes: listFiles(path.join(taskRoot, "dynamic", "processed", "keyframes"), [".png", ".jpg", ".jpeg", ".webp"]).length,
    },
    shared: {
      prompt: fs.existsSync(path.join(taskRoot, "prompt.txt")),
      instruction: fs.existsSync(path.join(taskRoot, "instruction.txt")),
    },
  };
}
