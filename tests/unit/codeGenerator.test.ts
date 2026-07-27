import { generateCode, CUSTOM_ALIAS_PATTERN, DEFAULT_CODE_LENGTH } from "../../src/services/codeGenerator";

describe("generateCode", () => {
  it("generates a code of the default length", () => {
    expect(generateCode()).toHaveLength(DEFAULT_CODE_LENGTH);
  });

  it("generates a code of a requested length", () => {
    expect(generateCode(12)).toHaveLength(12);
  });

  it("only uses Base62 characters", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCode()).toMatch(/^[0-9A-Za-z]+$/);
    }
  });

  it("produces different codes across calls (no fixed seed)", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });

  it("generated codes satisfy the custom alias pattern too", () => {
    expect(CUSTOM_ALIAS_PATTERN.test(generateCode())).toBe(true);
  });
});
