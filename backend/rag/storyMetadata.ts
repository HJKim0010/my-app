export type StoryTaskId = "task1" | "task2";

export function getMainCharacterName(taskId: StoryTaskId): "Jack" | "Anna" {
  return taskId === "task2" ? "Anna" : "Jack";
}

export function getMainCharacterStatusSummary(
  taskId: StoryTaskId,
  language: "korean" | "english"
): string {
  if (taskId === "task1") {
    return language === "english"
      ? "Jack is a student. The story mentions his student ID, final team project presentation, final grade, and graduation, so he can reasonably be understood as a college or university student."
      : "Jack은 학생입니다. 이야기에서 student ID, final team project presentation, final grade, graduation이 나오기 때문에 정황상 대학생으로 볼 수 있어요.";
  }

  return language === "english"
    ? "Anna is the main character and is shown after a long study session with a laptop and notebook. The story does not clearly state her exact official status, but she can reasonably be understood as a student or someone studying."
    : "Anna는 주인공이고, 긴 공부를 마친 뒤 laptop과 notebook을 챙기는 인물이에요. 원문이 정확한 신분을 단정하진 않지만, 학생이거나 공부하는 사람으로 볼 수 있어요.";
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
