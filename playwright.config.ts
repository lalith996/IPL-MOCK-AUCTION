import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config.
 *
 * Tests live in tests/e2e/.
 * In CI, set BASE_URL to the staging deployment URL.
 * Locally: `make dev` must be running (web on :3000, admin on :3001).
 */

const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:3000";
const ADMIN_URL = process.env["ADMIN_URL"] ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: process.env["CI"] === "true",
  retries: process.env["CI"] === "true" ? 2 : 0,
  workers: process.env["CI"] === "true" ? 2 : undefined,

  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["list"],
  ],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Wait up to 15 s for navigation (services may be slow to start)
    navigationTimeout: 15_000,
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],

  // Start dev server automatically when running locally
  webServer: process.env["CI"]
    ? undefined
    : [
        {
          command: "pnpm --filter @ipl/web dev",
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          command: `PORT=3001 pnpm --filter @ipl/admin dev`,
          url: ADMIN_URL,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      ],
});
