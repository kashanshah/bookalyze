import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // A stand-in for the Wise API (e2e/wise-mock.mjs); the app talks to it via WISE_API_URL.
      command: "node e2e/wise-mock.mjs",
      url: "http://localhost:4010/health",
      reuseExistingServer: true,
    },
    {
      command: "pnpm start",
      url: `http://localhost:${port}/sign-in`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        WISE_API_URL: process.env.WISE_API_URL ?? "http://localhost:4010",
        // Test-only key for the credential vault (32 zero bytes); real keys live in Vercel.
        APP_ENCRYPTION_KEY:
          process.env.APP_ENCRYPTION_KEY ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
    },
  ],
});
