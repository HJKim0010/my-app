import fs from "node:fs";
import path from "node:path";
import { loadTaskPackage, type TaskCondition, type TaskId } from "@/backend/rag/loader";

type ImageInput = {
  type: "input_image";
  image_url: string;
  detail: "auto";
};

function shouldAttachVisuals(query: string, condition: TaskCondition): boolean {
  const q = query.toLowerCase();
  const imageTerms = ["image", "picture", "photo", "look", "see", "visual"];
  const videoTerms = ["video", "scene", "frame", "moment", "screen", "watch"];
  const terms = condition === "static" ? imageTerms : videoTerms;

  return terms.some((term) => q.includes(term));
}

function toDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";
  const base64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${base64}`;
}

export function resolveVisualInputs(
  taskId: TaskId,
  query: string,
  condition: TaskCondition
): ImageInput[] {
  if (!shouldAttachVisuals(query, condition)) {
    return [];
  }

  const taskPackage = loadTaskPackage(taskId, condition);

  return taskPackage.visualAssets.slice(0, 2).map((asset) => ({
    type: "input_image",
    image_url: toDataUrl(asset.filePath),
    detail: "auto",
  }));
}
