import { test, expect } from "@playwright/test";
import { clearAllLinks, uniqueUrl } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await clearAllLinks(request);
  await page.goto("/ui/");
});

function destinationFor(baseURL: string | undefined, label: string): string {
  return `${baseURL}/ui/?e2e=${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("password-protected link: prompt -> wrong password -> correct password -> remembered via cookie", async ({
  page,
}) => {
  // Cross-origin destination is the point of this test, not incidental: an earlier
  // version of this suite used a same-origin destination here after wrongly diagnosing
  // a failure as "unreliable page.route interception for cross-origin redirects." The
  // real cause was Helmet's default CSP `form-action 'self'`, which blocks a *form
  // submission's resulting redirect* from crossing origins -- the server was always
  // responding correctly (302 + Location + Set-Cookie, confirmed via its own request
  // log), but the browser silently refused to follow the redirect, so nothing visibly
  // happened. Fixed in src/app.ts by widening `form-action` to allow http(s) (this
  // app's whole product is redirecting to arbitrary http(s) URLs -- see
  // engineering-summary.md's "Open redirect by design" note). This test exists
  // specifically to catch a regression of that CSP restriction; a same-origin
  // destination would never have caught it in the first place.
  const destination = uniqueUrl("locked");
  await page.route("https://example.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "destination reached" }),
  );

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

  // Correct password navigates through to the real (stubbed) cross-origin destination.
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
