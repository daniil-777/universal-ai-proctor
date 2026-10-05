// Rebuild only the additional visual fixtures. Bundled MP4s are ready to use.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const run = promisify(execFile);
for (const name of ["parts-sorting", "control-panel"]) {
  const project = fileURLToPath(
    new URL(`./video-projects/${name}/`, import.meta.url),
  );
  const output = fileURLToPath(
    new URL(`./assets/${name}.mp4`, import.meta.url),
  );
  await run(
    "npx",
    [
      "--yes",
      "hyperframes@0.8.123",
      "check",
      project,
      "--at",
      "1,3,5,7,9,11,13,15",
    ],
    { maxBuffer: 10_000_000 },
  );
  const result = await run(
    "npx",
    [
      "--yes",
      "hyperframes@0.8.123",
      "render",
      project,
      "--fps",
      "4",
      "--quality",
      "looks",
      "--output",
      output,
    ],
    { maxBuffer: 10_000_000 },
  );
  console.log(result.stdout.split("\n").slice(-5).join("\n"));
}
