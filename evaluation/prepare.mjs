import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../backend/package.json", import.meta.url),
);
const sharp = require("sharp");
import {
  additionalVideos,
  additionalCases,
  documents,
} from "./additional-cases.mjs";
const run = promisify(execFile);
const root = fileURLToPath(new URL("./", import.meta.url));
fs.mkdirSync(path.join(root, "assets"), { recursive: true });
const guidance =
  "Step 1: Read the label\nActions: Inspect the package label.\nCriteria: BOX A label visibly readable.\nStep 2: Place the blue block\nActions: Place one blue block in the open box.\nCriteria: One blue block visibly inside the box.\nStep 3: Apply tape\nActions: Close the box and place tape across its top.\nCriteria: Tape visibly across the box top.\nPrinciples: Confirm visible evidence before continuing. Hidden contents and temperatures cannot be verified from an image.";
fs.writeFileSync(path.join(root, "assets", "Packaging.txt"), guidance + "\n");
fs.copyFileSync(
  new URL("../guidance-library/Coffee_Brewing.txt", import.meta.url),
  path.join(root, "assets", "Coffee_Brewing.txt"),
);
function svg(stage, offset, width, height) {
  if (stage === 3)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 960 640"><rect width="960" height="640" fill="#e5edf3"/><g transform="translate(${offset},0)"><ellipse cx="480" cy="490" rx="260" ry="28" fill="#c0cbd4"/><rect x="230" y="230" width="500" height="230" rx="3" fill="#ba8853" stroke="#6e4b2e" stroke-width="5"/>${stage < 2 ? '<path d="M230 230L170 150H440L480 230M480 230L520 150H790L730 230" fill="#cea773" stroke="#6e4b2e" stroke-width="5"/><rect x="250" y="230" width="460" height="90" fill="#64492d"/>' : '<rect x="230" y="175" width="500" height="80" fill="#cea773" stroke="#6e4b2e" stroke-width="5"/><rect x="455" y="175" width="50" height="90" fill="#f4e5bb" stroke="#d0bd8b" stroke-width="2"/>'}${stage === 1 ? '<rect x="400" y="235" width="160" height="80" rx="4" fill="#1877df" stroke="#0b4380" stroke-width="5"/>' : ""}<rect x="342" y="350" width="276" height="70" rx="3" fill="white"/><text x="367" y="402" font-family="Arial" font-size="48" font-weight="bold" fill="#111">BOX A</text></g></svg>`;
}
for (const [name, width, height] of [
  ["packaging-landscape", 960, 640],
  ["packaging-portrait", 480, 800],
]) {
  const frames = path.join(root, "assets", `${name}-frames`);
  fs.mkdirSync(frames, { recursive: true });
  for (let i = 0; i < 16; i++)
    await sharp(Buffer.from(svg(Math.floor(i / 4), (i % 4) * 4, width, height)))
      .png()
      .toFile(path.join(frames, `${String(i).padStart(3, "0")}.png`));
  await run("ffmpeg", [
    "-loglevel",
    "error",
    "-framerate",
    "2",
    "-i",
    path.join(frames, "%03d.png"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    path.join(root, "assets", `${name}.mp4`),
  ]);
  fs.rmSync(frames, { recursive: true, force: true });
}
const fact = (id, all = [], any = [], negation_sensitive = false) => ({
  id,
  all,
  any,
  negation_sensitive,
});
const temperature = {
  id: "invented_temperature",
  patterns: ["\\b\\d+(?:\\.\\d+)?\\s*(?:°|degrees|celsius|fahrenheit)"],
};
const templates = [
  {
    id: "guardian-label",
    channel: "Guardian",
    time_s: 0.5,
    reference: "Packaging.txt",
    expected_answer: "An open box labeled BOX A is visible.",
    required_facts: [
      fact("label", ["box\\s*a"]),
      fact("open", [], ["open", "unsealed"]),
    ],
    expected_step: "S1",
  },
  {
    id: "guardian-block",
    channel: "Guardian",
    time_s: 2.5,
    reference: "Packaging.txt",
    expected_answer: "One blue block is visible in the open box.",
    required_facts: [fact("blue_block", ["blue", "block"])],
    expected_step: "S2",
  },
  {
    id: "guardian-tape",
    channel: "Guardian",
    time_s: 4.5,
    reference: "Packaging.txt",
    expected_answer: "Tape is visible across the top of the box.",
    required_facts: [
      fact(
        "tape",
        ["tape"],
        [
          "tape.{0,35}(?:visible|across|top|applied|present)",
          "(?:visible|applied|present).{0,30}tape",
        ],
        true,
      ),
      fact("box", ["box|package"]),
    ],
    forbidden_claims: [
      {
        id: "denied_visible_tape",
        patterns: ["no tape", "tape (?:is )?not (?:visible|observed|present)"],
      },
    ],
    expected_step: "S3",
  },
  {
    id: "guardian-covered",
    channel: "Guardian",
    time_s: 6.5,
    reference: "Packaging.txt",
    expected_answer: "The view is black and cannot be assessed.",
    required_facts: [
      fact(
        "unassessable",
        [],
        [
          "no discernible",
          "cannot.{0,25}(assess|see|observe)",
          "black",
          "covered",
        ],
      ),
    ],
    expected_quality: "unusable",
    expected_status: ["watch"],
  },
  {
    id: "guardian-mismatch",
    channel: "Guardian",
    time_s: 2.5,
    reference: "Coffee_Brewing.txt",
    expected_answer:
      "The visible packaging process does not match the coffee reference.",
    required_facts: [
      fact(
        "mismatch",
        ["coffee"],
        ["not", "unrelated", "mismatch", "no ", "instead", "rather"],
      ),
    ],
    unrelated_progress_must_be_zero: true,
  },
  {
    id: "guardian-no-document",
    channel: "Guardian",
    time_s: 2.5,
    reference: null,
    expected_answer:
      "A blue block is visible in a box; a provisional packing workflow can be proposed.",
    required_facts: [fact("box", ["box|package"]), fact("blue", ["blue"])],
    expect_discovery: true,
  },
  {
    id: "listener-label",
    channel: "Listener",
    time_s: 0.5,
    reference: "Packaging.txt",
    utterance: "Hey, what text is printed on the box?",
    question: "what text is printed on the box?",
    expected_answer: "The label reads BOX A.",
    required_facts: [fact("label", ["box\\s*a"])],
  },
  {
    id: "listener-empty",
    channel: "Listener",
    time_s: 1,
    reference: "Packaging.txt",
    utterance: "Hi, is a blue block visible inside the box?",
    question: "is a blue block visible inside the box?",
    expected_answer: "No blue block is visible in the open box.",
    required_facts: [
      fact(
        "absence",
        ["block"],
        ["\\bno\\b", "\\bnot\\b", "cannot", "can.t", "unable", "empty"],
      ),
    ],
    forbidden_claims: [
      {
        id: "false_visible_block",
        patterns: [
          "\\byes\\b",
          "blue block (?:is |appears |can be seen )?(?:visible|inside|present)",
          "there is (?:a|one) blue block",
        ],
      },
    ],
  },
  {
    id: "listener-color",
    channel: "Listener",
    time_s: 2.5,
    reference: "Packaging.txt",
    utterance: "Hello, what color is the visible block?",
    question: "what color is the visible block?",
    expected_answer: "The visible block is blue.",
    required_facts: [fact("blue", ["blue"])],
    forbidden_claims: [
      {
        id: "wrong_color",
        patterns: [
          "block.{0,20}(?:red|green|yellow)",
          "(?:red|green|yellow) block",
        ],
      },
    ],
  },
  {
    id: "listener-count",
    channel: "Listener",
    time_s: 2.8,
    reference: "Packaging.txt",
    utterance: "Hey, how many blue blocks are visible?",
    question: "how many blue blocks are visible?",
    expected_answer: "One blue block is visible.",
    required_facts: [fact("count", ["\\b(?:one|1|single)\\b", "blue"])],
    forbidden_claims: [
      {
        id: "wrong_count",
        patterns: ["\\b(?:two|three|2|3)\\b.{0,15}(?:blocks?|blue)"],
      },
    ],
  },
  {
    id: "listener-next-action",
    channel: "Listener",
    time_s: 3,
    reference: "Packaging.txt",
    utterance:
      "Hi, what is the next documented action after placing the blue block?",
    question:
      "what is the next documented action after placing the blue block?",
    expected_answer: "Close the box and apply tape across its top.",
    required_facts: [
      fact("next_tape", ["tape"]),
      fact("close", ["clos(?:e|ing|ed)"]),
    ],
  },
  {
    id: "listener-tape",
    channel: "Listener",
    time_s: 4.5,
    reference: "Packaging.txt",
    utterance: "Hey, is tape visibly present on the package?",
    question: "is tape visibly present on the package?",
    expected_answer: "Yes, tape is visible across the top of the box.",
    required_facts: [
      fact("tape", ["tape"], ["yes", "visible", "present", "across"]),
    ],
  },
  {
    id: "listener-hidden",
    channel: "Listener",
    time_s: 5,
    reference: "Packaging.txt",
    utterance: "Hello, is the blue block visible now?",
    question: "is the blue block visible now?",
    expected_answer: "No, the blue block is not visible in the closed box.",
    required_facts: [
      fact(
        "hidden",
        ["block"],
        ["\\bno\\b", "not visible", "hidden", "occluded", "cannot", "can.t"],
      ),
    ],
    forbidden_claims: [
      {
        id: "false_visible_block",
        patterns: ["\\byes\\b", "block is visible", "block is clearly visible"],
      },
    ],
  },
  {
    id: "listener-temperature",
    channel: "Listener",
    time_s: 5.3,
    reference: "Packaging.txt",
    utterance: "Hi, can you confirm the temperature of the box contents?",
    question: "can you confirm the temperature of the box contents?",
    expected_answer:
      "The contents temperature cannot be determined from these images.",
    required_facts: [
      fact(
        "temperature_unknown",
        ["temperature"],
        [
          "cannot",
          "can.t",
          "unable",
          "unknown",
          "not possible",
          "not visible",
          "no ",
        ],
      ),
    ],
    forbidden_claims: [temperature],
  },
  {
    id: "listener-covered",
    channel: "Listener",
    time_s: 6.5,
    reference: "Packaging.txt",
    utterance: "Hey, what is happening in the current view?",
    question: "what is happening in the current view?",
    expected_answer: "The view is black; no current action can be observed.",
    required_facts: [
      fact(
        "covered",
        [],
        [
          "black",
          "blank",
          "covered",
          "no visible",
          "cannot.{0,25}(see|observe|determine|assess)",
          "not visible",
        ],
      ),
    ],
  },
  {
    id: "listener-mismatch",
    channel: "Listener",
    time_s: 2.5,
    reference: "Coffee_Brewing.txt",
    utterance: "Hi, has coffee been brewed in this video?",
    question: "has coffee been brewed in this video?",
    expected_answer: "No coffee brewing is visible; this is a packaging scene.",
    required_facts: [
      fact(
        "not_coffee",
        ["coffee"],
        ["\\bno\\b", "not ", "cannot", "can.t", "unrelated", "no evidence"],
      ),
    ],
    forbidden_claims: [
      {
        id: "false_coffee_completion",
        patterns: [
          "\\byes\\b",
          "coffee (?:has been|is) brewed",
          "brewing (?:is|has) completed",
        ],
      },
    ],
  },
];
for (const [name, text] of Object.entries(documents))
  fs.writeFileSync(path.join(root, "assets", name), text);
const videos = [
  "packaging-landscape.mp4",
  "packaging-portrait.mp4",
  ...additionalVideos,
];
const cases = videos.slice(0, 2).flatMap((video) =>
  templates.map((spec) => ({
    ...spec,
    id: `${video.replace(".mp4", "")}:${spec.id}`,
    video,
    forbidden_claims: spec.forbidden_claims || [],
  })),
);
const contradictionRules = {
  "parts-sorting:guardian-partial-red": [
    [
      "no_red_inside",
      [
        "no red (?:circles|parts).{0,30}(?:inside|in the left)",
        "no actions (?:taken|have been taken)",
        "two red circles.{0,25}above",
      ],
    ],
  ],
  "parts-sorting:guardian-wrong-bin": [
    [
      "empty_bins",
      [
        "bins.{0,20}(?:remain|are) empty",
        "no parts have been sorted",
          "blue square.{0,20}above (?:the )?bins",
        "blue square (?:is|sits|is visible).{0,20}(?:in (?:the )?right|in (?:the )?blue only)",
      ],
    ],
  ],
  "parts-sorting:guardian-unexpected": [
    [
      "missing_green",
      [
        "no (?:extra|unexpected|green).{0,25}(?:part|triangle)",
          "no parts (?:visible )?above",
        "only (?:three|3) parts",
      ],
    ],
  ],
  "control-panel:guardian-connected-off": [
    [
      "false_disconnected",
      ["plug.{0,20}not seated", "cable.{0,20}disconnected"],
    ],
  ],
  "control-panel:guardian-on-green": [
    ["wrong_off", ["switch.{0,30}off"]],
    [
      "false_disconnected",
      ["plug.{0,30}not inserted", "cable.{0,20}disconnected"],
    ],
  ],
  "control-panel:guardian-connection-lost": [
    ["wrong_off", ["switch.{0,30}off"]],
    ["false_connected", ["cable is connected", "plug is seated"]],
  ],
};
for (const test of additionalCases) {
  for (const [id, patterns] of contradictionRules[test.id] || [])
    test.forbidden_claims.push({ id, patterns });
}
fs.writeFileSync(
  path.join(root, "dataset.json"),
  JSON.stringify(
    {
      version: 6,
      description:
        "Generated visual ground truth: empty labeled box (0–2s), one blue block in box (2–4s), closed taped box (4–6s), black view (6–8s). The portrait variant uses the same facts with a different viewport. Additional 16s clips show colored-part sorting (including a wrong bin, recovery, and an extra green triangle) and panel inspection (OFF/ON, connection loss, red/green indicator, and a 42 V display). Each has an obstruction at 8–10s. This is a synthetic process benchmark, not clinical validation.",
      videos,
      cases: [...cases, ...additionalCases],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${videos.length} videos, ${cases.length + additionalCases.length} annotated Guardian/listener cases and four guidance documents.`,
);
