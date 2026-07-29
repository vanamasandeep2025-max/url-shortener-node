/**
 * Minimal, self-contained (no external assets) HTML page prompting for a
 * protected link's password. Plain <form> POST so it works without JavaScript.
 * `code` is always server-validated against the same charset as short codes/
 * aliases before this is ever called, so it's safe to interpolate directly.
 */
export function renderPasswordPromptPage(code: string, opts: { error?: boolean } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Password required</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #f4f5f7; color: #1a1d29;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #fff; border: 1px solid #e2e4e9; border-radius: 10px; padding: 2rem 2.25rem;
          box-shadow: 0 1px 3px rgba(16,24,40,0.08); max-width: 340px; width: 100%; }
  .lock { font-size: 1.6rem; margin-bottom: 0.5rem; }
  h1 { font-size: 1.05rem; margin: 0 0 0.4rem; }
  p { font-size: 0.85rem; color: #6b7280; margin: 0 0 1.25rem; }
  input { width: 100%; padding: 0.6rem 0.7rem; border: 1px solid #e2e4e9; border-radius: 6px; font-size: 0.95rem;
          box-sizing: border-box; }
  button { width: 100%; margin-top: 0.75rem; padding: 0.6rem; border: 0; border-radius: 6px;
           background: #4f46e5; color: #fff; font-weight: 600; font-size: 0.9rem; cursor: pointer; }
  button:hover { background: #4338ca; }
  .error { color: #dc2626; font-size: 0.82rem; margin: 0.6rem 0 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="lock">🔒</div>
    <h1>This link is password protected</h1>
    <p>Enter the password to continue to your destination.</p>
    <form method="post" action="/${code}/unlock">
      <input type="password" name="password" placeholder="Password" autofocus required minlength="4" maxlength="72" />
      <button type="submit">Continue</button>
    </form>
    ${opts.error ? '<p class="error">Incorrect password. Please try again.</p>' : ""}
  </div>
</body>
</html>`;
}
