export type StoryTaskId = "task1" | "task2";

export function getMainCharacterName(taskId: StoryTaskId): "Jack" | "Anna" {
  return taskId === "task2" ? "Anna" : "Jack";
}

function normalizeRoutingText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function detectMainCharacterNameRequest(query: string): boolean {
  const normalized = normalizeRoutingText(query);

  return /(main\s+character|protagonist|hero|heroine|주인공|중심\s*인물).*(name|who|누구|이름|알려)|(?:name|who|누구|이름).*(main\s+character|protagonist|hero|heroine|주인공|중심\s*인물)/i.test(
    normalized
  );
}
