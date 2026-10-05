import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Limit discovery to application tests. Preserved dependency backups may
    // contain their own tests and offloaded iCloud files.
    include: ["tests/**/*.test.ts"],
  },
});
