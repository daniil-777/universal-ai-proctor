import { createApp } from "./app.js";
import { config } from "./config.js";
const app = await createApp({ logger: true });
await app.listen({ host: config.host, port: config.port });
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
