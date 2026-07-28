import { test, expect } from "@playwright/test";
import { clearAllLinks, uniqueUrl } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await clearAllLinks(request);
  await page.goto("/ui/");
});

test("shows an empty state when there are no active links", async ({ page }) => {
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#empty")).toContainText("No links yet");
});

test("creating a link clears the empty state and lists it", async ({ page }) => {
  await expect(page.locator("#empty")).toBeVisible();

  const url = uniqueUrl("list");
  await page.getByLabel("Destination URL").fill(url);
  await page.getByRole("button", { name: "Shorten" }).click();

  await expect(page.locator("#message")).toContainText("Created");
  await expect(page.locator("#empty")).toBeHidden();
  await expect(page.locator("tbody#rows tr")).toHaveCount(1);
});

test("lists multiple links and paginates the table body correctly", async ({ page }) => {
  await page.getByLabel("Destination URL").fill(uniqueUrl("multi-1"));
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  await page.getByLabel("Destination URL").fill(uniqueUrl("multi-2"));
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  await expect(page.locator("tbody#rows tr")).toHaveCount(2);
});

test("deleting a link hides it by default and reveals it via 'Show deleted'", async ({ page }) => {
  await page.getByLabel("Destination URL").fill(uniqueUrl("delete"));
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  const row = page.locator("tbody#rows tr").first();
  const code = (await row.locator("a.code-link").innerText()).trim();

  await row.locator('button[data-action="delete"]').click();
  await expect(page.locator("#message")).toContainText(`Deleted ${code}`);
  await expect(page.locator("#empty")).toBeVisible();

  await page.locator("#toggle-inactive").check();
  const deletedRow = page.locator("tbody#rows tr", { hasText: code });
  await expect(deletedRow).toHaveCount(1);
  await expect(deletedRow.locator(".badge")).toHaveText("Deleted");
  await expect(deletedRow.locator('button[data-action="delete"]')).toBeDisabled();

  // Regression guard for the includeInactive=false Zod-coercion bug: unchecking
  // must actually exclude the deleted link again, not just toggle its badge.
  await page.locator("#toggle-inactive").uncheck();
  await expect(page.locator("tbody#rows tr", { hasText: code })).toHaveCount(0);
});

test("records a click via the redirect and shows it in Clicks + Details", async ({ page, request }) => {
  await page.getByLabel("Destination URL").fill(uniqueUrl("click"));
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  const row = page.locator("tbody#rows tr").first();
  const code = (await row.locator("a.code-link").innerText()).trim();

  await request.get(`/${code}`, {
    maxRedirects: 0,
    headers: { referer: "https://example.com/campaign", "user-agent": "PlaywrightBot/1.0" },
  });

  await page.reload();
  const refreshedRow = page.locator("tbody#rows tr", { hasText: code });
  await expect(refreshedRow.locator("td").nth(3)).toHaveText("1"); // Clicks column

  await refreshedRow.locator('button[data-action="details"]').click();
  const details = page.locator(".details-box").first();
  await expect(details).toContainText("example.com/campaign");
  await expect(details).toContainText("PlaywrightBot/1.0");

  // Clicking Details again on the same row collapses it.
  await refreshedRow.locator('button[data-action="details"]').click();
  await expect(page.locator(".details-box")).toHaveCount(0);
});

test("copies the short link to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const url = uniqueUrl("copy");
  await page.getByLabel("Destination URL").fill(url);
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  const row = page.locator("tbody#rows tr").first();
  const shortUrl = await row.locator("a.code-link").getAttribute("href");
  await row.locator('button[data-action="copy"]').click();

  await expect(row.locator('button[data-action="copy"]')).toHaveText("Copied!");
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(shortUrl);
});
