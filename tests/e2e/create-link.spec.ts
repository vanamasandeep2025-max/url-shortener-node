import { test, expect } from "@playwright/test";
import { clearAllLinks, uniqueAlias, uniqueUrl } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await clearAllLinks(request);
  await page.goto("/ui/");
});

test("creates a short link with a randomly generated code", async ({ page }) => {
  const url = uniqueUrl("random-code");
  await page.getByLabel("Destination URL").fill(url);
  await page.getByRole("button", { name: "Shorten" }).click();

  await expect(page.locator("#message")).toContainText("Created http://localhost:");
  const row = page.locator("tbody#rows tr", { hasText: url.slice(0, 45) });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".badge")).toHaveText("Active");
});

test("creates a short link with a custom alias", async ({ page }) => {
  const url = uniqueUrl("alias");
  const alias = uniqueAlias("alias");
  await page.getByLabel("Destination URL").fill(url);
  await page.getByLabel("Custom alias").fill(alias);
  await page.getByRole("button", { name: "Shorten" }).click();

  await expect(page.locator("#message")).toContainText(`/${alias}`);
  await expect(page.locator(`a.code-link:text-is("${alias}")`)).toBeVisible();
});

test("creates a short link with a future expiry date", async ({ page }) => {
  const url = uniqueUrl("expiry");
  await page.getByLabel("Destination URL").fill(url);

  // +25h margin: datetime-local values are parsed as local time by `new Date()`,
  // so a naive UTC slice could otherwise land in the past depending on timezone.
  const future = new Date(Date.now() + 25 * 60 * 60 * 1000);
  await page.locator("#expiresAt").fill(future.toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Shorten" }).click();

  await expect(page.locator("#message")).toContainText("Created");
  const row = page.locator("tbody#rows tr", { hasText: url.slice(0, 45) });
  await expect(row.locator(".badge")).toHaveText("Active");
});

test("rejects a disallowed URL scheme with a server-side validation error", async ({ page }) => {
  await page.getByLabel("Destination URL").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Shorten" }).click();

  await expect(page.locator("#message")).toHaveClass(/error/);
  await expect(page.locator("#message")).toContainText("http(s)");
});

test("rejects a malformed custom alias with a server-side validation error", async ({ page }) => {
  await page.getByLabel("Destination URL").fill(uniqueUrl("bad-alias"));
  const aliasInput = page.getByLabel("Custom alias");
  await aliasInput.fill("ab"); // below the 3-char minimum

  // The input's `pattern` attribute mirrors the server rule exactly, so the browser would
  // otherwise block submission itself. Remove it to actually exercise server-side validation.
  await aliasInput.evaluate((el: HTMLInputElement) => el.removeAttribute("pattern"));
  await page.getByRole("button", { name: "Shorten" }).click();

  await expect(page.locator("#message")).toHaveClass(/error/);
});

test("the browser itself blocks a malformed custom alias before any request is sent", async ({ page }) => {
  await page.getByLabel("Destination URL").fill(uniqueUrl("bad-alias-native"));
  await page.getByLabel("Custom alias").fill("ab");
  await page.getByRole("button", { name: "Shorten" }).click();

  // Native constraint validation should block the submit handler entirely.
  await expect(page.locator("tbody#rows tr")).toHaveCount(0);
  await expect(page.locator("#message")).toBeEmpty();
});

test("shows a conflict error when a custom alias is already taken", async ({ page }) => {
  const alias = uniqueAlias("dup");

  await page.getByLabel("Destination URL").fill(uniqueUrl("dup-1"));
  await page.getByLabel("Custom alias").fill(alias);
  await page.getByRole("button", { name: "Shorten" }).click();
  await expect(page.locator("#message")).toContainText("Created");

  await page.getByLabel("Destination URL").fill(uniqueUrl("dup-2"));
  await page.getByLabel("Custom alias").fill(alias);
  await page.getByRole("button", { name: "Shorten" }).click();

  await expect(page.locator("#message")).toHaveClass(/error/);
  await expect(page.locator("#message")).toContainText("already in use");
});
