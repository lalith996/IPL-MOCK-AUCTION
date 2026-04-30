/**
 * E2E: Admin console (http://localhost:3001)
 *
 * Tests:
 *  1. Login page renders
 *  2. Wrong password shows error
 *  3. Correct password shows dashboard
 *  4. Create session button + form visible
 *  5. Approval gate blocks start until checked
 *  6. Session list polls and renders cards
 *  7. Replay viewer opens + closes
 *  8. Unauthenticated → login redirect
 */

import { test, expect, type Page } from "@playwright/test";

const ADMIN_BASE_URL = process.env["ADMIN_URL"] ?? "http://localhost:3001";

async function loginAs(page: Page, password: string) {
  await page.goto(ADMIN_BASE_URL);
  await page.getByLabel("Operator ID").fill("admin");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

test.describe("Admin console", () => {
  test("login page renders with form", async ({ page }) => {
    await page.goto(ADMIN_BASE_URL);
    await expect(page.getByRole("heading", { name: /IPL 2026 Admin/i })).toBeVisible();
    await expect(page.getByLabel("Operator ID")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("wrong password shows error message", async ({ page }) => {
    await page.route("**/api/auth/operator", (route) =>
      route.fulfill({ status: 401, json: { error: "Invalid credentials" } }),
    );

    await loginAs(page, "wrong");
    await expect(page.getByText("Invalid credentials")).toBeVisible();
  });

  test("successful login shows dashboard", async ({ page }) => {
    await page.route("**/api/auth/operator", (route) =>
      route.fulfill({ json: { token: "mock-jwt-token" } }),
    );
    await page.route("**/api/auctions", (route) =>
      route.fulfill({ json: [] }),
    );

    await loginAs(page, "changeme");
    await expect(page.getByText("IPL 2026 Admin Console")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Create New Session")).toBeVisible();
  });

  test("approval gate shown before session list", async ({ page }) => {
    await page.route("**/api/auth/operator", (route) =>
      route.fulfill({ json: { token: "mock-jwt-token" } }),
    );
    await page.route("**/api/auctions", (route) =>
      route.fulfill({ json: [] }),
    );

    await loginAs(page, "changeme");
    await expect(page.getByText("Operator Approval Required")).toBeVisible({ timeout: 5_000 });
  });

  test("start button disabled until approvals checked", async ({ page }) => {
    const session = {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      seed: 42,
      status: "prep",
      createdAt: new Date().toISOString(),
    };

    await page.route("**/api/auth/operator", (route) =>
      route.fulfill({ json: { token: "mock-jwt-token" } }),
    );
    await page.route("**/api/auctions", (route) =>
      route.fulfill({ json: [session] }),
    );

    await loginAs(page, "changeme");
    await expect(page.getByText("Operator Approval Required")).toBeVisible({ timeout: 5_000 });

    // Start button should exist but be disabled before approval
    const startBtn = page.getByRole("button", { name: /Start/ });
    await expect(startBtn).toBeDisabled();

    // Check both approval checkboxes
    const checkboxes = page.getByRole("checkbox");
    await checkboxes.first().check();
    await checkboxes.last().check();
    await page.getByRole("button", { name: /Confirm Approvals/ }).click();

    // Now start button enabled
    await expect(startBtn).toBeEnabled({ timeout: 3_000 });
  });

  test("session card shows pause for active session", async ({ page }) => {
    const session = {
      id: "bbbbbbbb-0000-0000-0000-000000000002",
      seed: 42,
      status: "nominating",
      createdAt: new Date().toISOString(),
    };

    await page.route("**/api/auth/operator", (route) =>
      route.fulfill({ json: { token: "mock-jwt-token" } }),
    );
    await page.route("**/api/auctions", (route) =>
      route.fulfill({ json: [session] }),
    );

    await loginAs(page, "changeme");
    await expect(page.getByRole("button", { name: /Pause/ })).toBeVisible({ timeout: 5_000 });
  });

  test("replay viewer opens on Replay click", async ({ page }) => {
    const session = {
      id: "cccccccc-0000-0000-0000-000000000003",
      seed: 42,
      status: "ended",
      createdAt: new Date().toISOString(),
    };

    await page.route("**/api/auth/operator", (route) =>
      route.fulfill({ json: { token: "mock-jwt-token" } }),
    );
    await page.route("**/api/auctions", (route) =>
      route.fulfill({ json: [session] }),
    );
    // Return empty NDJSON
    await page.route("**/api/auctions/*/replay", (route) =>
      route.fulfill({ status: 200, body: "", headers: { "Content-Type": "application/x-ndjson" } }),
    );

    await loginAs(page, "changeme");
    await page.getByRole("button", { name: /Replay/ }).click();
    await expect(page.getByText(`Replay: ${session.id}`)).toBeVisible({ timeout: 5_000 });

    // Close button
    await page.getByRole("button", { name: "✕" }).click();
    await expect(page.getByText(`Replay: ${session.id}`)).not.toBeVisible();
  });

  test("sign out returns to login", async ({ page }) => {
    await page.route("**/api/auth/operator", (route) =>
      route.fulfill({ json: { token: "mock-jwt-token" } }),
    );
    await page.route("**/api/auctions", (route) =>
      route.fulfill({ json: [] }),
    );

    await loginAs(page, "changeme");
    await expect(page.getByText("Sign out")).toBeVisible({ timeout: 5_000 });
    await page.getByText("Sign out").click();
    await expect(page.getByRole("heading", { name: /IPL 2026 Admin/i })).toBeVisible();
  });
});
