import { test, expect } from "@playwright/test";
import { clearAllLinks } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await clearAllLinks(request);
  await page.goto("/ui/");
});

// Destinations point back at this app's own origin (a distinctive query string on
// /ui/) rather than an external domain. An earlier version of this test pointed at
// https://example.com and stubbed it via page.route(), which turned out to be an
// unreliable way to assert "the browser followed the redirect" -- redirect-driven
// cross-origin navigations weren't reliably intercepted in this environment, causing
// the test to hang waiting on a real network round-trip. Asserting against our own
// server removes that dependency entirely and is a more robust test either way.
function destinationFor(baseURL: string | undefined, label: string): string {
  return `${baseURL}/ui/?e2e=${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("password-protected link: prompt -> wrong password -> correct password -> remembered via cookie", async ({
  page,
  baseURL,
}) => {
  const destination = destinationFor(baseURL, "locked");

  await page.getByLabel("Destination URL").fill(destination);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  const row = page.locator("tbody#rows tr").first();
  const shortUrl = await row.locator("a.code-link").getAttribute("href");

  // Visiting the link shows the password prompt, not the destination.
  await page.goto(shortUrl!);
  await expect(page.locator("h1")).toContainText("password protected");

  // Wrong password keeps us on the prompt with an error, doesn't leak through.
  await page.locator('input[name="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".error")).toContainText("Incorrect password");
  await expect(page).not.toHaveURL(destination);

  // Correct password navigates through to the real destination.
  await page.locator('input[name="password"]').fill("correct-horse");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(destination);

  // Revisiting in the same browser context (same cookie jar) skips the prompt
  // entirely, since the short-lived unlock cookie is still valid.
  await page.goto(shortUrl!);
  await expect(page).toHaveURL(destination);
});

test("dashboard shows a lock indicator for password-protected links", async ({ page, baseURL }) => {
  await page.getByLabel("Destination URL").fill(destinationFor(baseURL, "lock-badge"));
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  const row = page.locator("tbody#rows tr").first();
  await expect(row).toContainText("🔒");
});

test("a link created without a password is never gated", async ({ page, baseURL }) => {
  const destination = destinationFor(baseURL, "open");

  await page.getByLabel("Destination URL").fill(destination);
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  const row = page.locator("tbody#rows tr").first();
  const shortUrl = await row.locator("a.code-link").getAttribute("href");
  await expect(row).not.toContainText("🔒");

  await page.goto(shortUrl!);
  await expect(page).toHaveURL(destination);
});
