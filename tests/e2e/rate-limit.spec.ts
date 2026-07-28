import { test, expect } from "@playwright/test";

// Runs against its own server instance (RATE_LIMIT_POINTS=3, see playwright.config.ts's
// "rate-limit" project) so this can never starve, or be starved by, any other spec's
// create-link calls sharing the same per-IP quota.

test("rate limits rapid link creation and surfaces the error in the UI", async ({ page, request }) => {
  await page.goto("/ui/");

  let sawRateLimit = false;
  for (let i = 0; i < 15 && !sawRateLimit; i++) {
    const res = await request.post("/api/urls", {
      data: { url: `https://example.com/rl-${i}-${Date.now()}` },
    });
    if (res.status() === 429) {
      sawRateLimit = true;
      expect(res.headers()["retry-after"]).toBeTruthy();
    }
  }
  expect(sawRateLimit).toBe(true);

  // The quota is still exhausted; a real form submission should surface the same 429.
  await page.getByLabel("Destination URL").fill("https://example.com/rl-ui-check");
  await page.getByRole("button", { name: "Shorten" }).click();

  await expect(page.locator("#message")).toHaveClass(/error/);
  await expect(page.locator("#message")).toContainText("rate limit");
});
