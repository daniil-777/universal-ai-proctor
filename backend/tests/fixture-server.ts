import { createApp } from "../src/app.js";
import { GuidanceEngine } from "../src/pipeline/guidance.js";
import { fixtureComplete } from "./fixtures.js";
import { AccountStore } from "../src/account/store.js";
const accountStore = new AccountStore({ file: ":memory:" });
const app = await createApp({
  engine: new GuidanceEngine(fixtureComplete),
  accountStore,
});
await app.listen({ host: "127.0.0.1", port: 8102 });
console.log("Deterministic UI test server: http://127.0.0.1:8102");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(
    signal,
    () =>
      void app.close().then(() => {
        accountStore.close();
        process.exit(0);
      }),
  );
