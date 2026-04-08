import type { RestrictionReason } from "@/backend/policy/classifier";

export function redirectResponse(reason: RestrictionReason): string {
  switch (reason) {
    case "whole_source_summary":
      return "I cannot summarize the whole story for you. You can ask about one short part, one character, one problem, or one selected scene from the assigned materials.";
    case "draft_feedback":
      return "I cannot correct or rewrite your draft. I can help you understand the story, plan your ideas, or find useful words and expressions.";
    case "outside_content":
      return "I cannot add outside content beyond the assigned materials. I can help you think of ideas that stay consistent with the story you were given.";
    case "sentence_generation":
    default:
      return "I cannot write the answer or continuation for you. I can help with one scene, possible ideas, writing plans, useful words and expressions, or one short sentence pattern.";
  }
}
