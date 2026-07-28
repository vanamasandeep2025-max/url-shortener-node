import type { APIRequestContext } from "@playwright/test";

/**
 * Soft-deletes every currently active link so a test can assert against a known
 * (empty, active) starting point without needing direct DB access. Deleted rows
 * remain in the table (this app never hard-deletes), so this only ever affects
 * the "active" view -- accumulating soft-deleted rows across runs is expected
 * and harmless for these tests.
 */
export async function clearAllLinks(request: APIRequestContext): Promise<void> {
  const res = await request.get("/api/urls?limit=100&includeInactive=false");
  const body = await res.json();
  for (const item of body.items ?? []) {
    await request.delete(`/api/urls/${item.code}`);
  }
}

export function uniqueUrl(label: string): string {
  return `https://example.com/e2e/${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function uniqueAlias(label: string): string {
  return `e2e-${label}-${Date.now().toString(36)}`.slice(0, 32);
}
