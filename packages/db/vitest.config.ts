import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/__tests__/global-setup.ts"],
    fileParallelism: false,
  },
});
