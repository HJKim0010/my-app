import type { RestrictionReason } from "@/backend/policy/classifier";

export function redirectResponse(reason: RestrictionReason): string {
  switch (reason) {
    case "sentence_translation":
      return [
        "\uC804\uCCB4 \uBB38\uC7A5\uC744 \uADF8\uB300\uB85C \uBC88\uC5ED\uD558\uAE30\uBCF4\uB2E4, \uC9C1\uC811 \uC644\uC131\uD560 \uC218 \uC788\uAC8C \uD575\uC2EC\uC744 \uC7A1\uC544\uBCFC\uAC8C\uC694.",
        "\uBA3C\uC800 \uBB38\uC7A5\uC758 \uD0A4\uC6CC\uB4DC\uB97C \uACE0\uB974\uACE0, \uB3D9\uC0AC\uB098 \uD45C\uD604 \uD6C4\uBCF4 \uC911\uC5D0\uC11C \uC120\uD0DD\uD574 \uBCF4\uC138\uC694.",
        "Key choices: [who] / [did what] / [where or why]",
        "Pattern: [Subject] + [verb] + [object/detail]",
        "\uC774 \uD2C0\uC5D0 \uB2F9\uC2E0\uC758 \uD0A4\uC6CC\uB4DC\uB97C \uB123\uC5B4 \uBA3C\uC800 \uD55C \uBB38\uC7A5\uC744 \uB9CC\uB4E4\uC5B4 \uBCF4\uC138\uC694.",
      ].join("\n");
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
