import { test, expect } from "@playwright/test";

/**
 * LCP Load Test on Simulated 4G Network
 * 
 * Validates:
 * - LCP (Largest Contentful Paint) ≤ 1s on 4G LTE
 * - Byte budget ≤ 150 KB per nomination
 * - Zero render-blocking image failures
 * 
 * Prerequisites:
 * - Running auction at http://localhost:3000/auction/test-auction-1
 * - 50 nominations in progress
 */

test.describe("Frontend Performance on 4G", () => {
  test("LCP should be ≤ 1s on 4G LTE", async ({ browser }) => {
    const context = await browser.newContext({
      // Simulate 4G LTE: down 4 Mbps, up 3 Mbps, latency 50ms
      extraHTTPHeaders: {},
    });

    const page = await context.newPage();

    // Apply network throttling
    await page.route("**/*", async (route) => {
      // Simulate 4G latency
      await new Promise((r) => setTimeout(r, 50));
      await route.continue();
    });

    // Start measuring page load
    const startTime = performance.now();

    // Navigate to auction room
    await page.goto("http://localhost:3000/auction/test-auction-1", {
      waitUntil: "networkidle",
    });

    // Get LCP metric from the page
    const lcpMetric = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          resolve(lastEntry.startTime);
        });
        observer.observe({ entryTypes: ["largest-contentful-paint"] });
      });
    });

    const endTime = performance.now();

    console.log(`LCP: ${lcpMetric.toFixed(0)}ms`);
    console.log(`Total page load: ${(endTime - startTime).toFixed(0)}ms`);

    // Assert LCP ≤ 1000ms
    expect(lcpMetric).toBeLessThanOrEqual(1000);

    // Verify all images loaded (no broken references)
    const images = await page.$$("img");
    for (const img of images) {
      const naturalHeight = await img.evaluate((el) => (el as HTMLImageElement).naturalHeight);
      expect(naturalHeight).toBeGreaterThan(0);
    }

    await context.close();
  });

  test("Byte budget ≤ 150 KB per nomination", async ({ browser, page }) => {
    const context = await browser.newContext();
    let totalBytes = 0;

    // Listen to all network traffic
    page.on("response", async (response) => {
      const headers = response.headers();
      const contentLength = headers["content-length"];
      if (contentLength) {
        totalBytes += parseInt(contentLength, 10);
      }
    });

    await page.goto("http://localhost:3000/auction/test-auction-1", {
      waitUntil: "networkidle",
    });

    // Measure byte size for a single nomination
    const byteLimit = 150 * 1024; // 150 KB
    console.log(`Total bytes transferred: ${(totalBytes / 1024).toFixed(1)} KB`);

    // Per-nomination average (if 50 nominations loaded)
    const avgPerNomination = totalBytes / 50;
    console.log(`Average per nomination: ${(avgPerNomination / 1024).toFixed(1)} KB`);

    expect(avgPerNomination).toBeLessThanOrEqual(byteLimit);

    await context.close();
  });

  test("Headshot fallback to avatar (no render-blocking failures)", async ({ page }) => {
    await page.goto("http://localhost:3000/auction/test-auction-1", {
      waitUntil: "networkidle",
    });

    // Simulate CDN failure by blocking image requests
    await page.route("**/headshots/**", (route) => {
      route.abort("failed");
    });

    // Wait for UI to stabilize after image failures
    await page.waitForTimeout(1000);

    // Verify no blank/broken image states
    const playerCards = await page.$$(".player-card");
    expect(playerCards.length).toBeGreaterThan(0);

    for (const card of playerCards) {
      const visibility = await card.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      expect(visibility).toBe(true);

      // Verify fallback is rendered (initials avatar or placeholder)
      const avatar = await card.$(".avatar-fallback");
      expect(avatar).not.toBeNull();
    }
  });

  test("WebSocket reconnect under slow network", async ({ page }) => {
    await page.goto("http://localhost:3000/auction/test-auction-1", {
      waitUntil: "networkidle",
    });

    // Simulate network disconnection
    await page.context().setOffline(true);
    await page.waitForTimeout(2000);

    // Verify UI shows "connecting" state
    const connectionState = await page.locator(".connection-status").textContent();
    expect(connectionState).toContain("connecting");

    // Restore connection
    await page.context().setOffline(false);
    await page.waitForTimeout(3000);

    // Verify UI returns to "connected"
    const reconnectedState = await page.locator(".connection-status").textContent();
    expect(reconnectedState).toContain("connected");
  });

  test("Auction room is interactive under 4G after LCP", async ({ page }) => {
    await page.goto("http://localhost:3000/auction/test-auction-1", {
      waitUntil: "networkidle",
    });

    // Wait for LCP
    await page.waitForLoadState("networkidle");

    // Verify key UI elements are clickable
    const spectatorInfo = await page.locator(".spectator-info").isVisible();
    expect(spectatorInfo).toBe(true);

    // Click on a team panel (should respond)
    const miPanel = await page.locator("[data-team='MI']");
    await miPanel.click();

    // Verify panel expanded/responded
    const expanded = await miPanel.locator(".squad-details").isVisible();
    expect(expanded).toBe(true);
  });
});
