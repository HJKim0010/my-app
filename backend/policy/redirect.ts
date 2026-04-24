import type { RestrictionReason } from "@/backend/policy/classifier";

export function redirectResponse(reason: RestrictionReason): string {
  switch (reason) {
    case "draft_rewrite":
      return [
        "I cannot rewrite the whole draft for you, but I can still help you improve it.",
        "1. Check the logic and flow",
        "2. Point out grammar or expression problems",
        "3. Revise one sentence at a time",
        "4. Make a short outline for the next part",
      ].join("\n");
    case "outside_content":
      return [
        "I should stay connected to the story, reading, or video and your own continuation idea.",
        "I can still help you develop a new event if it fits the story situation, mood, conflict, or clue.",
        "1. Test whether your idea fits",
        "2. Suggest 2 or 3 connected next events",
        "3. Organize the flow",
        "4. Improve local expressions",
      ].join("\n");
    case "sentence_generation":
    default:
      return [
        "I cannot write the whole continuation for you, but I can help you build it.",
        "1. Make a 3-step plot outline",
        "2. Suggest 2 or 3 possible next events",
        "3. Check your draft for grammar and logic",
        "4. Revise one sentence at a time",
      ].join("\n");
  }
}
