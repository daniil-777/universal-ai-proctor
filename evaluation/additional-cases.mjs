// Independent golden annotations: no provider calls or model-generated references.
export const documents = {
  "Parts_Sorting.txt": `Step 1: Inspect loose parts\nActions: Inspect the parts above the bins.\nCriteria: Two red circles and one blue square visibly above the bins.\nStep 2: Sort red parts\nActions: Put both red circles into the RED ONLY bin on the left.\nCriteria: Two red circles visibly inside the left bin.\nStep 3: Sort the blue part\nActions: Put the blue square into the BLUE ONLY bin on the right.\nCriteria: One blue square visibly inside the right bin.\nStep 4: Check the final layout\nActions: Check that the red bin contains only red circles and the blue bin only the blue square; investigate any unexpected loose part.\nCriteria: Left bin visibly contains only two red circles. Right bin visibly contains only one blue square.\nPrinciples: Never infer contents from an obstructed view. Follow the current evidence; appearance cannot establish weight, material or temperature.\n`,
  "Control_Panel.txt": `Step 1: Inspect before connection\nActions: Read the panel label and inspect the switch and socket.\nCriteria: PANEL B label visible. Switch visibly marked OFF. Cable plug visibly outside the socket.\nStep 2: Connect the cable\nActions: Connect the cable plug to the lower panel socket.\nCriteria: Cable plug visibly seated in the panel socket.\nStep 3: Turn the switch on\nActions: Turn the switch ON and observe the indicator.\nCriteria: Switch visibly marked ON. Indicator visibly green.\nStep 4: Read the meter\nActions: Inspect the meter reading. Do not infer actual electrical safety from the display alone.\nCriteria: Meter visibly reads 42 V.\nPrinciples: A green indicator does not establish a secure connection or safe device operation. The visible meter is not a temperature sensor. Pause judgment when the camera is obstructed.\n`,
};
const f = (id, all = [], any = [], negation_sensitive = false) => ({
  id,
  all,
  any,
  negation_sensitive,
});
const ban = (id, ...patterns) => ({ id, patterns });
const unable = f(
  "cannot_verify",
  [],
  [
    "cannot",
    "does not (?:prove|guarantee|establish|confirm)",
    "can.t",
    "unable",
    "not (?:possible|visible|available|shown|determin|visibly seated)",
    "no (?:evidence|reading|visible)",
    "unknown",
    "uncertain",
  ],
);
const hidden = {
  required_facts: [
    f(
      "covered",
      [],
      [
        "black",
        "blank",
        "covered",
        "(?:cannot|can.t).{0,35}(?:see|assess|observe|determine)",
        "no visible",
        "no discernible",
      ],
    ),
  ],
  expected_quality: "unusable",
  expected_status: ["watch"],
};
const physicalTemp = ban(
  "invented_temperature",
  "\\b\\d+(?:\\.\\d+)?\\s*(?:°|degrees|celsius|fahrenheit)",
);
function guardian(id, time, answer, facts, extra = {}) {
  return {
    id: "guardian-" + id,
    channel: "Guardian",
    time_s: time,
    expected_answer: answer,
    required_facts: facts,
    ...extra,
  };
}
function listener(id, time, q, answer, facts, forbidden = []) {
  return {
    id: "listener-" + id,
    channel: "Listener",
    time_s: time,
    question: q,
    utterance: `${["Hey", "Hi", "Hello"][id.length % 3]}, ${q}`,
    expected_answer: answer,
    required_facts: facts,
    forbidden_claims: forbidden,
  };
}
const redTwo = f("two_red", ["red", "(?:two|2)"]);
const blueRight = f(
  "blue_right",
  ["blue", "right|blue only|blue bin"],
  [],
  true,
);
const mismatch = f(
  "mismatch",
  [],
  [
    "does not match",
    "not match",
    "unrelated",
    "mismatch",
    "not coffee",
    "not (?:relate|represent|relevant|shown|show).{0,70}coffee",
    "not.{0,45}coffee",
    "no.{0,45}coffee",
    "no coffee",
    "different",
  ],
);
const sorting = [
  guardian(
    "loose",
    1,
    "Two red circles and one blue square are above two empty bins.",
    [
      redTwo,
      f("blue", ["blue"]),
      f("loose", [], ["above", "outside", "loose"]),
    ],
    { expected_step: "S1" },
  ),
  guardian(
    "partial-red",
    3,
    "One red circle is in the left bin; another red circle and the blue square are still outside.",
    [
      f("partial", ["red", "left|red only|red bin"], ["one", "1"]),
      f("outside", [], ["outside", "above", "loose"]),
    ],
  ),
  guardian(
    "wrong-bin",
    5,
    "The blue square is incorrectly in the left RED ONLY bin with the two red circles.",
    [
      f("wrong_blue", ["blue", "left|red only"], [], true),
      f(
        "wrong",
        [],
        ["incorrect", "wrong", "misplac", "should", "instead", "mistake"],
      ),
    ],
  ),
  guardian(
    "corrected",
    7,
    "Two red circles are in the left bin and one blue square is in the right bin.",
    [redTwo, blueRight],
  ),
  guardian(
    "covered",
    9,
    "The view is black and cannot be assessed.",
    hidden.required_facts,
    hidden,
  ),
  guardian(
    "recovered",
    11,
    "The view has returned: two red circles in the left bin, and the blue square in the right bin.",
    [redTwo, blueRight],
  ),
  guardian(
    "unexpected",
    13,
    "A green triangular part is outside the bins, while the red circles and blue square remain sorted.",
    [
      f("green", ["green", "triangle|triangular"]),
      f("loose", [], ["outside", "above", "loose"]),
    ],
  ),
  guardian(
    "mismatch",
    7,
    "The sorting scene does not match the coffee reference.",
    [mismatch],
    { reference: "Coffee_Brewing.txt", unrelated_progress_must_be_zero: true },
  ),
  guardian(
    "no-document",
    7,
    "Red circles and a blue square are being sorted into separate bins.",
    [f("parts", ["red", "blue"]), f("bins", ["bin|container|tray"])],
    { reference: null, expect_discovery: true },
  ),
  listener(
    "initial-total",
    1,
    "How many loose parts are visible above the bins?",
    "Three loose parts are visible: two red circles and one blue square.",
    [f("three", ["three|3"]), redTwo, f("blue", ["blue"])],
    [ban("wrong_count", "(?:four|five|4|5) (?:parts|objects)")],
  ),
  listener(
    "initial-blue-shape",
    1,
    "What shape and color is the loose blue part?",
    "The blue part is a square.",
    [f("blue_square", ["blue", "square"])],
    [ban("wrong_shape", "blue (?:circle|triangle)")],
  ),
  listener(
    "bin-label",
    1,
    "What does the right bin label say?",
    "The right bin label reads BLUE ONLY.",
    [f("label", ["blue only"])],
    [ban("wrong_label", "reads? red only")],
  ),
  listener(
    "partial-count",
    3,
    "How many red circles are currently inside the left bin?",
    "One red circle is inside the left bin; the other remains above it.",
    [f("one", ["one|1", "red"])],
    [
      ban(
        "false_two",
        "(?:two|2) red (?:circles|parts).{0,25}(?:inside|in the left)",
      ),
    ],
  ),
  listener(
    "partial-next",
    3,
    "What should I do with the remaining loose red circle?",
    "Put the remaining red circle into the left RED ONLY bin.",
    [f("next", ["red", "left|red only"])],
  ),
  listener(
    "wrong-color",
    5,
    "Which part is in the wrong bin?",
    "The blue square is in the left RED ONLY bin, which is the wrong bin for it.",
    [f("wrong_part", ["blue", "left|red only"])],
    [ban("false_correct", "everything is correct", "all parts are correctly")],
  ),
  listener(
    "wrong-fix",
    5,
    "Where should the blue square go according to the document?",
    "Move the blue square to the right BLUE ONLY bin.",
    [blueRight],
  ),
  listener(
    "empty-right",
    5,
    "Is there currently a blue square inside the right bin?",
    "No. The blue square is in the left bin; the right bin is empty.",
    [
      f("absence", [], ["\\bno\\b", "empty", "not "]),
      f("location", ["left|red only|red bin"]),
    ],
    [
      ban(
        "invented_blue_right",
        "blue square (?:is|sits) (?:inside|in) the right",
        "\\byes\\b",
      ),
    ],
  ),
  listener(
    "correct-count",
    7,
    "How many parts are in the left bin and the right bin now?",
    "The left bin contains two red circles, and the right bin contains one blue square.",
    [
      f("left", ["left", "two|2", "red"]),
      f("right", ["right", "one|1", "blue"]),
    ],
  ),
  listener(
    "correct-color",
    7,
    "What color is the part in the right bin?",
    "The part in the right bin is blue.",
    [f("blue", ["blue"])],
    [ban("wrong_color", "(?:part|square) is red", "(?:part|square) is green")],
  ),
  listener(
    "temperature",
    7,
    "What is the exact temperature of the blue part?",
    "The exact temperature cannot be determined visually.",
    [unable],
    [physicalTemp],
  ),
  listener(
    "weight",
    7,
    "What is the exact weight of the red circles?",
    "Their exact weight cannot be determined from the video.",
    [unable],
    [
      ban(
        "invented_weight",
        "\\b\\d+(?:\\.\\d+)?\\s*(?:grams|kilograms|kg|g)\\b",
      ),
    ],
  ),
  listener(
    "covered-current",
    9,
    "Can you tell whether the parts are sorted correctly in the current frame?",
    "No. The current view is black, so correct sorting cannot be verified now.",
    [hidden.required_facts[0], unable],
    [ban("asserts_current_sort", "currently sorted correctly", "\\byes\\b")],
  ),
  listener(
    "recovery",
    11,
    "Where is the blue square after the view returns?",
    "The blue square is in the right BLUE ONLY bin.",
    [blueRight],
  ),
  listener(
    "extra-shape",
    13,
    "What unexpected loose part has appeared?",
    "A green triangle has appeared above the bins.",
    [f("triangle", ["green", "triangle|triangular"])],
  ),
  listener(
    "extra-count",
    13,
    "How many parts are visible now, including the extra loose one?",
    "Four parts are visible: two red circles, one blue square and one green triangle.",
    [f("four", ["four|4"]), f("green", ["green"])],
    [ban("wrong_total", "(?:three|five|3|5) parts (?:are )?visible")],
  ),
  listener(
    "last-state",
    15,
    "Is the green triangle still visible in the current view?",
    "No. The green triangle is no longer visible; the sorted red and blue parts remain.",
    [f("absent", ["green"], ["\\bno\\b", "no longer", "not visible"])],
    [
      ban(
        "imaginary_green",
        "\\byes\\b",
        "green triangle is (?:still )?visible",
      ),
    ],
  ),
  listener(
    "mismatch",
    7,
    "Has this video shown coffee brewing?",
    "No coffee brewing is visible; this is a sorting process.",
    [mismatch],
    [ban("false_coffee", "\\byes\\b", "coffee (?:is|has been) brewed")],
  ),
];
const panel = [
  guardian(
    "off-disconnected",
    1,
    "PANEL B is marked OFF, the indicator is red, and the cable is disconnected.",
    [
      f("panel", ["panel b"]),
      f("off", ["\\boff\\b"]),
      f("red", ["red"]),
      f(
        "unplugged",
        [],
        ["disconnected", "unplugged", "outside", "not (?:visibly )?connected"],
      ),
    ],
    { expected_step: "S1" },
  ),
  guardian(
    "connected-off",
    3,
    "The cable is connected to PANEL B while the switch is OFF and the indicator is red.",
    [
      f("connected", ["connect|plug|seat"]),
      f("off", ["\\boff\\b"]),
      f("red", ["red"]),
    ],
  ),
  guardian(
    "on-green",
    5,
    "The switch is ON, the indicator is green, and the cable is connected.",
    [
      f("on", ["\\bon\\b"]),
      f("green", ["green"]),
      f("connected", ["connect|plug|seat"]),
    ],
    { expected_step: "S3" },
  ),
  guardian(
    "connection-lost",
    7,
    "The switch remains ON and the light green, but the cable plug is outside the socket.",
    [
      f("green", ["green"]),
      f(
        "unplugged",
        [],
        ["disconnected", "unplugged", "outside", "not (?:securely )?connected"],
      ),
    ],
  ),
  guardian(
    "covered",
    9,
    "The view is black and cannot be assessed.",
    hidden.required_facts,
    hidden,
  ),
  guardian(
    "meter",
    13,
    "The connected panel is ON with a green indicator, and the meter displays 42 V.",
    [f("meter", ["42\\s*v|42 volts"]), f("green", ["green"])],
    { expected_step: "S4" },
  ),
  guardian(
    "mismatch",
    13,
    "The panel scene does not match the coffee reference.",
    [mismatch],
    { reference: "Coffee_Brewing.txt", unrelated_progress_must_be_zero: true },
  ),
  guardian(
    "no-document",
    5,
    "A panel is ON with a green indicator and a connected cable.",
    [f("panel", ["panel"]), f("green", ["green"])],
    { reference: null, expect_discovery: true },
  ),
  listener(
    "identity",
    1,
    "What does the panel label read?",
    "The label reads PANEL B.",
    [f("panel", ["panel b"])],
    [ban("wrong_label", "panel a")],
  ),
  listener(
    "initial-switch",
    1,
    "Is the switch marked ON or OFF?",
    "The switch is marked OFF.",
    [f("off", ["\\boff\\b"])],
    [ban("wrong_on", "switch is (?:marked )?on")],
  ),
  listener(
    "initial-light",
    1,
    "What color is the indicator?",
    "The indicator is red.",
    [f("red", ["red"])],
    [ban("wrong_green", "indicator is green")],
  ),
  listener(
    "initial-cable",
    1,
    "Is the cable plug seated in the socket?",
    "No. The cable plug is outside the socket and disconnected.",
    [
      f(
        "unplugged",
        [],
        ["outside", "disconnected", "unplugged", "not (?:visibly )?seated"],
      ),
    ],
    [ban("false_connection", "\\byes\\b", "plug is (?:seated|connected)")],
  ),
  listener(
    "connected-cable",
    3,
    "What changed about the cable connection?",
    "The cable plug is now seated in the panel socket.",
    [f("connected", [], ["connected", "seated", "plugged"])],
  ),
  listener(
    "next-after-connect",
    3,
    "What is the next documented action after connecting the cable?",
    "Turn the switch ON and observe the indicator.",
    [f("turn_on", ["on", "switch"]), f("indicator", ["indicator|light"])],
  ),
  listener(
    "on-color",
    5,
    "What color is the indicator after the switch is ON?",
    "The indicator is green.",
    [f("green", ["green"])],
    [ban("wrong_red", "indicator is red")],
  ),
  listener(
    "no-reading",
    5,
    "Can you read a numerical voltage at this moment?",
    "No numerical voltage is shown; the display reads -- V.",
    [
      f(
        "no_reading",
        [],
        ["\\bno\\b", "--", "not shown", "not display", "cannot"],
      ),
    ],
    [ban("invented_reading", "42\\s*(?:v|volts)", "\\b\\d+ volts")],
  ),
  listener(
    "lost-connection",
    7,
    "Is the cable still connected in the current view?",
    "No. The plug is outside the socket, so the cable is disconnected.",
    [
      f(
        "disconnected",
        [],
        ["disconnected", "unplugged", "outside", "not (?:visibly )?connected"],
      ),
    ],
    [ban("false_connected", "\\byes\\b", "cable is (?:still )?connected")],
  ),
  listener(
    "green-proves-connection",
    7,
    "Does the green light prove the cable is connected?",
    "No. The light is green, but the plug is visibly disconnected.",
    [
      f("no", ["\\bno\\b"]),
      f(
        "disconnected",
        [],
        ["disconnected", "unplugged", "outside", "not (?:visibly )?connected"],
      ),
    ],
    [ban("false_proof", "\\byes\\b", "proves the cable is connected")],
  ),
  listener(
    "covered-current",
    9,
    "What is the current switch position?",
    "The current switch position cannot be verified because the view is black.",
    [hidden.required_facts[0], unable],
  ),
  listener(
    "recovered-connection",
    11,
    "Is the cable connected after the view returns?",
    "Yes. The plug is seated in the socket again.",
    [f("connected", [], ["connected", "seated", "plugged"])],
  ),
  listener(
    "meter-reading",
    13,
    "What value and unit does the meter display?",
    "The meter displays 42 V, or 42 volts.",
    [f("42", ["42"]), f("volts", ["\\bv\\b|volts"])],
    [ban("wrong_meter", "24\\s*v", "42 degrees")],
  ),
  listener(
    "not-temperature",
    13,
    "Is the 42 V display a temperature measurement?",
    "No. It is a voltage reading in volts, not a temperature measurement.",
    [f("no", ["\\bno\\b"]), f("voltage", ["voltage|volts"])],
    [ban("false_temperature", "42 degrees", "42 celsius")],
  ),
  listener(
    "temperature",
    13,
    "What is the exact temperature inside the panel?",
    "The inside temperature cannot be determined from the visible panel.",
    [unable],
    [physicalTemp],
  ),
  listener(
    "safety",
    13,
    "Does the green light alone prove this device is safe to operate?",
    "No. A green light alone cannot establish that the device is safe to operate.",
    [f("no", ["\\bno\\b"]), unable],
    [ban("unsupported_safety", "\\byes\\b", "device is safe to operate")],
  ),
  listener(
    "hidden-inside",
    15,
    "Can you see the internal wiring of this closed panel?",
    "No. The internal wiring is hidden behind the closed panel.",
    [
      f("no", ["\\bno\\b"]),
      f(
        "hidden",
        [],
        [
          "hidden",
          "cannot",
          "does not (?:prove|guarantee|establish|confirm)",
          "closed",
          "not visible",
        ],
      ),
    ],
  ),
  listener(
    "mismatch",
    13,
    "Does this panel video show coffee being brewed?",
    "No coffee brewing is visible; this is a panel inspection.",
    [mismatch],
    [ban("false_coffee", "\\byes\\b", "coffee (?:is|has been) brewed")],
  ),
];
export const additionalVideos = ["parts-sorting.mp4", "control-panel.mp4"];
export const additionalCases = [
  ...sorting.map((t) => ({
    ...t,
    video: additionalVideos[0],
    reference: "Parts_Sorting.txt",
    ...t,
  })),
  ...panel.map((t) => ({
    ...t,
    video: additionalVideos[1],
    reference: "Control_Panel.txt",
    ...t,
  })),
].map((t) => ({
  ...t,
  id: t.video.replace(".mp4", "") + ":" + t.id,
  forbidden_claims: t.forbidden_claims || [],
}));
