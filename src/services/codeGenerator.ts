import { randomInt } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const DEFAULT_CODE_LENGTH = 7;
export const CUSTOM_ALIAS_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/**
 * Generates a random Base62 code using crypto.randomInt, which is rejection-sampled
 * and therefore unbiased (unlike `Math.random() * 62 | 0`).
 */
export function generateCode(length: number = DEFAULT_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}
