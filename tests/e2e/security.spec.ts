import { test, expect } from "@playwright/test";
import { clearAllLinks } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await clearAllLinks(request);
  await page.goto("/ui/");
});

test("escapes a malicious long URL instead of executing it (stored-XSS regression)", async ({ page }) => {
  // Regression guard for the stored-XSS bug found while building this dashboard:
  // longUrl is only checked for a valid http(s) scheme server-side, never HTML-sanitized.
  let dialogFired = false;
  page.on("dialog", async (dialog) => {
    dialogFired = true;
    await dialog.dismiss();
  });

  const payload = 'https://example.com/"><img src=x onerror=alert(1)>';
  await page.getByLabel("Destination URL").fill(payload);
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  // Give any (unexpected) onerror handler a moment to fire before asserting it didn't.
  await page.waitForTimeout(300);
  expect(dialogFired).toBe(false);
  await expect(page.locator(".long-url img")).toHaveCount(0);
  // The visible cell text is truncated at 45 chars for long URLs; the full escaped
  // value lives in the `title` attribute, so check that instead of the display text.
  const title = await page.locator("td.long-url").first().getAttribute("title");
  expect(title).toContain("img src=x onerror=alert(1)");
});

test("escapes a malicious referrer/user-agent in the click details view", async ({ page, request }) => {
  await page.getByLabel("Destination URL").fill("https://example.com/e2e/security-details");
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  const row = page.locator("tbody#rows tr").first();
  const code = (await row.locator("a.code-link").innerText()).trim();

  let dialogFired = false;
  page.on("dialog", async (dialog) => {
    dialogFired = true;
    await dialog.dismiss();
  });

  await request.get(`/${code}`, {
    maxRedirects: 0,
    headers: {
      referer: '"><img src=x onerror=alert(1)>',
      "user-agent": '"><img src=x onerror=alert(2)>',
    },
  });

  await page.reload();
  await page.locator("tbody#rows tr", { hasText: code }).locator('button[data-action="details"]').click();

  await page.waitForTimeout(300);
  expect(dialogFired).toBe(false);
  await expect(page.locator(".details-box img")).toHaveCount(0);
  await expect(page.locator(".details-box").first()).toContainText("img src=x onerror=alert");
});
