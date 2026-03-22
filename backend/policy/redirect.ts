import type { RestrictionReason } from "./classifier";

export function redirectResponse(reason: RestrictionReason): string {
  if (reason === "whole_source_summary") {
    return `
I cannot summarize the whole source for you.

I can still help in a limited way:

1. Clarify one specific scene, line, or timestamp
2. Explain what happens in one short part of the source
3. Track one character's feeling, goal, or problem in a selected segment

Try asking about one scene or one detail from the assigned materials.
`;
  }

  if (reason === "draft_feedback") {
    return `
I cannot correct, rewrite, or evaluate your draft for you.

I can still help in a limited way:

1. Suggest general ways to organize your continuation
2. Explain a useful word or expression
3. Offer an abstract sentence frame with blanks

Try asking for planning help, vocabulary help, or a general writing pattern.
`;
  }

  if (reason === "outside_content") {
    return `
I cannot add outside content knowledge beyond the assigned source.

I can still help in a limited way:

1. Find ideas based only on the given source
2. Clarify what a specific scene implies
3. Help you plan a continuation that stays consistent with the source

Try asking about a source-based idea, conflict, emotion, or next-step possibility.
`;
  }

  return `
I cannot write the answer for you, but I can help you plan it.

Here are 3 possible directions:

1. Focus on the character's reaction
2. Develop the situation further
3. Add a new event based on the source

Try choosing one and writing it in your own words.
`;
}
