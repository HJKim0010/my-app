import type { TaskDocument } from "@/backend/rag/loader";

export type TaskChunk = {
  chunkId: string;
  taskId: string;
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
  chunkIndex: number;
  chunkCount: number;
  documentChunkIndex: number;
  documentChunkCount: number;
  content: string;
};

const MAX_CHUNK_LENGTH = 500;
const OVERLAP_SENTENCES = 1;

function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r/g, "");

  return (normalized.match(/[^.!?。！？]+(?:[.!?。！？]+["'”’)]*)?|[^.!?。！？]+$/gu) || [normalized])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

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
    const sentences = splitSentences(block);
    let current: string[] = [];

    for (const sentence of sentences.length ? sentences : [block]) {
      const candidate = [...current, sentence].join(" ");

      if (candidate.length <= MAX_CHUNK_LENGTH || current.length === 0) {
        current.push(sentence);
        continue;
      }

      segments.push(current.join(" ").trim());
      current = current.slice(-OVERLAP_SENTENCES);
      current.push(sentence);
    }

    if (current.length > 0) {
      segments.push(current.join(" ").trim());
    }
  }

  return segments.filter(Boolean);
}

export function chunkDocuments(taskId: string, documents: TaskDocument[]): TaskChunk[] {
  const chunks = documents.flatMap((document) => {
    const segments = splitIntoSegments(document.content);
    return segments.map((content, index) => ({
      chunkId: `${taskId}:${document.id}:${index}`,
      taskId,
      sourceId: document.id,
      sourceType: document.sourceType,
      sourceLabel: document.label,
      chunkIndex: index,
      chunkCount: segments.length,
      documentChunkIndex: index,
      documentChunkCount: segments.length,
      content,
    }));
  });

  return chunks.map((chunk, index) => ({
    ...chunk,
    chunkIndex: index,
  }));
}
