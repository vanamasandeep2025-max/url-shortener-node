const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
export const MAX_LONG_URL_LENGTH = 2048;

export function isValidLongUrl(candidate: string): boolean {
  if (!candidate || candidate.length > MAX_LONG_URL_LENGTH) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}
