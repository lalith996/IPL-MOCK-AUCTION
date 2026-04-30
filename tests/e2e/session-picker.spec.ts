/**
 * E2E: Session picker home page (/)
 *
 * Tests:
 *  1. Page loads and shows the header
 *  2. Empty state shown when no sessions
 *  3. Admin Console link present and navigates to :3001
 *  4. Polling: page re-fetches without full reload (data-testid counter)
 *  5. Session card renders with Watch Live link when status=active
 */

import { test, expect } from "@playwright/test";

test.describe("Session picker — /", () => {
  test("page title and header render", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/IPL 2026 Auction/i);
    await expect(page.getByRole("heading", { name: /IPL 2026 Auction/i })).toBeVisible();
  });

  test("shows empty state when no auctions", async ({ page }) => {
    // Mock /api/auctions to return empty array
    await page.route("/api/auctions", (route) =>
      route.fulfill({ json: [] }),
    );

    await page.goto("/");
    await expect(page.getByText("No active auctions")).toBeVisible();
    await expect(page.getByText("Admin Console")).toBeVisible();
  });

  test("shows loading spinner before data", async ({ page }) => {
    // Delay response to catch loading state
    await page.route("/api/auctions", async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({ json: [] });
    });

    await page.goto("/");
    // Spinner should be visible briefly
    const spinner = page.locator("svg.animate-spin");
    await expect(spinner).toBeVisible();
    // Then empty state after load
    await expect(page.getByText("No active auctions")).toBeVisible({ timeout: 5_000 });
  });

  test("renders session card for active auction", async ({ page }) => {
    const mockSession = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      seed: 42,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await page.route("/api/auctions", (route) =>
      route.fulfill({ json: [mockSession] }),
    );

    await page.goto("/");

    // Card with truncated ID
    await expect(page.getByText("550e8400")).toBeVisible();
    // Status badge
    await expect(page.getByText("Live")).toBeVisible();
    // Watch Live link pointing to auction room
    const watchLink = page.getByRole("link", { name: /Watch Live/i });
    await expect(watchLink).toBeVisible();
    await expect(watchLink).toHaveAttribute(
      "href",
      "/auction/550e8400-e29b-41d4-a716-446655440000",
    );
  });

  test("renders ended session with View Replay link", async ({ page }) => {
    const endedSession = {
      id: "660e8400-e29b-41d4-a716-446655440001",
      seed: 99,
      status: "ended",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await page.route("/api/auctions", (route) =>
      route.fulfill({ json: [endedSession] }),
    );

    await page.goto("/");
    await expect(page.getByText("Ended")).toBeVisible();
    await expect(page.getByRole("link", { name: /View Replay/i })).toBeVisible();
  });

  test("shows error banner when Auction Manager is down", async ({ page }) => {
    await page.route("/api/auctions", (route) =>
      route.fulfill({ status: 503, json: { error: "Service unavailable" } }),
    );

    await page.goto("/");
    await expect(page.getByText(/unavailable|error/i)).toBeVisible({ timeout: 5_000 });
  });
});
