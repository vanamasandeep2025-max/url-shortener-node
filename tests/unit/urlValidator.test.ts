import { isValidLongUrl, MAX_LONG_URL_LENGTH } from "../../src/services/urlValidator";

describe("isValidLongUrl", () => {
  it.each(["http://example.com", "https://example.com/a/b?c=1#d", "https://sub.example.co.uk:8443/path"])(
    "accepts %s",
    (url) => {
      expect(isValidLongUrl(url)).toBe(true);
    },
  );

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isValidLongUrl(url)).toBe(false);
  });

  it("rejects URLs longer than the max length", () => {
    const longUrl = `https://example.com/${"a".repeat(MAX_LONG_URL_LENGTH)}`;
    expect(isValidLongUrl(longUrl)).toBe(false);
  });
});
