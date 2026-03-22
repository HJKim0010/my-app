import fs from "node:fs";
import path from "node:path";

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
  condition: TaskCondition;
  conditionLabel: string;
  documents: TaskDocument[];
  prompt: string;
  instruction: string;
  visualAssets: VisualAsset[];
};

const TASK_ROOT = path.join(process.cwd(), "data", "task1");

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

export function getTask1Config(): TaskConfig {
  const configPath = path.join(TASK_ROOT, "task.json");

  return readJsonFile<TaskConfig>(configPath, {
    task_id: "task1",
    title: "Task 1",
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

function buildCandidateDocuments(condition: TaskCondition): TaskDocument[] {
  const staticRoot = path.join(TASK_ROOT, "static");
  const dynamicRoot = path.join(TASK_ROOT, "dynamic");
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

  const sharedPrompt = readTextFile(path.join(TASK_ROOT, "prompt.txt"));
  const sharedInstruction = readTextFile(path.join(TASK_ROOT, "instruction.txt"));

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
        filePath: path.join(TASK_ROOT, "prompt.txt"),
      },
      {
        id: "instruction",
        sourceType: "instruction",
        label: "Task Instruction",
        content: sharedInstruction,
        filePath: path.join(TASK_ROOT, "instruction.txt"),
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
        filePath: path.join(TASK_ROOT, "prompt.txt"),
      },
      {
        id: "instruction",
        sourceType: "instruction",
        label: "Task Instruction",
        content: sharedInstruction,
        filePath: path.join(TASK_ROOT, "instruction.txt"),
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

function buildVisualAssets(condition: TaskCondition): VisualAsset[] {
  const staticImages = listFiles(path.join(TASK_ROOT, "static", "raw", "images"), [
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

  const dynamicKeyframes = listFiles(path.join(TASK_ROOT, "dynamic", "processed", "keyframes"), [
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

export function loadTask1Package(condition?: TaskCondition): TaskPackage {
  const config = getTask1Config();
  const resolvedCondition = condition || config.default_condition;
  const conditionConfig = config.conditions[resolvedCondition];
  const documents = dedupeDocuments(
    buildCandidateDocuments(resolvedCondition).filter((candidate) =>
      conditionConfig.allowed_sources.includes(candidate.id)
    )
  );

  return {
    config,
    condition: resolvedCondition,
    conditionLabel: conditionConfig.condition_label,
    documents,
    prompt: readTextFile(path.join(TASK_ROOT, "prompt.txt")),
    instruction: readTextFile(path.join(TASK_ROOT, "instruction.txt")),
    visualAssets: buildVisualAssets(resolvedCondition),
  };
}

export function getTask1SessionStatus() {
  return {
    task_root: TASK_ROOT,
    static: {
      source_text: fs.existsSync(path.join(TASK_ROOT, "static", "raw", "source_text.txt")),
      audio_transcript: fs.existsSync(path.join(TASK_ROOT, "static", "processed", "audio_transcript.txt")),
      images: listFiles(path.join(TASK_ROOT, "static", "raw", "images"), [".png", ".jpg", ".jpeg", ".webp"]).length,
    },
    dynamic: {
      video_transcript: fs.existsSync(path.join(TASK_ROOT, "dynamic", "processed", "video_transcript.txt")),
      scene_labels: fs.existsSync(path.join(TASK_ROOT, "dynamic", "processed", "scene_labels.json")),
      keyframes: listFiles(path.join(TASK_ROOT, "dynamic", "processed", "keyframes"), [".png", ".jpg", ".jpeg", ".webp"]).length,
    },
    shared: {
      prompt: fs.existsSync(path.join(TASK_ROOT, "prompt.txt")),
      instruction: fs.existsSync(path.join(TASK_ROOT, "instruction.txt")),
    },
  };
}
