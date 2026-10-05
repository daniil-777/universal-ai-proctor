import sharp from "sharp";
import type { Complete } from "../src/llm/client.js";
export const fixtureDocument =
  "Safety\nAlways check the work area.\nStep 1 — Prepare\nActions: Place the tool on the table.\nCriteria: Tool visibly on table.\nStep 2 — Finish\nActions: Put the tool away.\nCriteria: Tool visibly stored.";
export async function texturedFrame(seed = 0): Promise<string> {
  const color = seed % 2 ? "#39a6bb" : "#db6234";
  return (
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><rect width="128" height="96" fill="#f1e1cb"/><rect x="${8 + (seed % 60)}" y="8" width="56" height="64" fill="${color}"/><path d="M0 40h128M64 0v96" stroke="#123" stroke-width="4"/></svg>`,
      ),
    )
      .jpeg()
      .toBuffer()
  ).toString("base64");
}
// Deterministic test service. It is never used by the production server.
export const fixtureComplete: Complete = async (input) => {
  input.signal?.throwIfAborted();
  if (input.prompt.startsWith("Extract the provided"))
    return JSON.stringify({
      title: "Test assembly",
      steps: [
        {
          step: "Prepare",
          actions: "Place the tool",
          criteria: "Tool on table",
        },
        { step: "Finish", actions: "Store the tool", criteria: "Tool stored" },
      ],
      principles: ["Always check the work area."],
    });
  if (!input.json) {
    const answer =
      "The visible tool is on the table. Check the work area before proceeding to the next documented action.";
    for (const word of answer.match(/\S+\s*/g) || []) input.onDelta?.(word);
    return answer;
  }
  const empty = input.prompt.includes('"steps":[]');
  // Browser regressions can request a retained alert with this explicit marker
  // in their test guidance. Production never imports this fixture provider.
  const alertFixture = input.prompt.includes("FOR_REVIEW_ALERT");
  return JSON.stringify({
    summary: "Test fixture: tool visible on the table.",
    guidance: "Check the work area before the next documented action.",
    principle: "Always keep the work area clear.",
    status: alertFixture ? "alert" : "watch",
    concern: alertFixture
      ? "Test fixture: alert requires an operator review of the work area."
      : "Test fixture: review the visible work area.",
    current_step_id: "S1",
    steps: [
      {
        id: "S1",
        confidence: 0.9,
        criteria: [
          {
            key: "S1C1",
            frame_indices: [
              Math.max(
                0,
                (
                  JSON.parse(
                    /Frame timestamps .*?: (\[[^\n]*?\])/.exec(
                      input.prompt,
                    )?.[1] || "[0]",
                  ) as number[]
                ).length - 1,
              ),
            ],
            status: "met",
            evidence: "Test fixture: tool visible on table.",
          },
        ],
      },
    ],
    discovered_steps: empty
      ? [
          {
            step: "Prepare the workspace",
            actions: "Place the tool",
            criteria: "Tool visible on table",
          },
          {
            step: "Perform the visible task",
            actions: "Observe the task",
            criteria: "Task visibly performed",
          },
          {
            step: "Finish and review",
            actions: "Review the result",
            criteria: "Result visible",
          },
        ]
      : [],
  });
};
