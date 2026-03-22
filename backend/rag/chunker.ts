import type { TaskDocument } from "@/backend/rag/loader";

export type TaskChunk = {
  chunkId: string;
  taskId: string;
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
  chunkIndex: number;
  content: string;
};

const MAX_CHUNK_LENGTH = 500;

function splitIntoSegments(content: string): string[] {
  const normalized = content.replace(/\r/g, "").trim();

  if (!normalized) {
    return [];
  }

  const blocks = normalized
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const segments: string[] = [];

  for (const block of blocks) {
    if (block.length <= MAX_CHUNK_LENGTH) {
      segments.push(block);
      continue;
    }

    let start = 0;

    while (start < block.length) {
      segments.push(block.slice(start, start + MAX_CHUNK_LENGTH).trim());
      start += MAX_CHUNK_LENGTH;
    }
  }

  return segments.filter(Boolean);
}

export function chunkDocuments(taskId: string, documents: TaskDocument[]): TaskChunk[] {
  return documents.flatMap((document) =>
    splitIntoSegments(document.content).map((content, index) => ({
      chunkId: `${taskId}:${document.id}:${index}`,
      taskId,
      sourceId: document.id,
      sourceType: document.sourceType,
      sourceLabel: document.label,
      chunkIndex: index,
      content,
    }))
  );
}
