import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  createUserId,
  createUsername,
  generateSessionToken,
  hashPassword,
  verifyPassword,
} from "./auth";

describe("auth helpers", () => {
  it("hashes with a unique salt and verifies only the matching password", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^\$scrypt\$/);
    await expect(verifyPassword("correct horse battery staple", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
  });

  it("rejects invalid password inputs and malformed or unsupported hashes", async () => {
    await expect(hashPassword("")).rejects.toThrow(/non-empty/);
    await expect(hashPassword("x".repeat(1025))).rejects.toThrow(/at most/);
    await expect(verifyPassword("", "bad")).resolves.toBe(false);
    await expect(verifyPassword("secret", "bad")).resolves.toBe(false);
    await expect(verifyPassword("secret", "$scrypt$999999999$8$1$abc$def")).resolves.toBe(false);
  });

  it("validates user identifiers and normalizes usernames", () => {
    expect(createUserId("  user-1 ")).toBe("user-1");
    expect(() => createUserId("  ")).toThrow(/non-empty/);
    expect(() => createUserId(null)).toThrow(/non-empty/);
    expect(createUsername("  Ada_42 ")).toBe("ada_42");
    for (const invalid of ["ab", "has space", "bad-name", "x".repeat(33), ""]) {
      expect(() => createUsername(invalid)).toThrow();
    }
    expect(() => createUsername(42)).toThrow(/must be a string/);
  });

  it("generates and validates opaque session tokens", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createSessionToken(token)).toBe(token);
    expect(generateSessionToken()).not.toBe(token);
    expect(() => createSessionToken("short")).toThrow(/32-byte/);
  });
});
