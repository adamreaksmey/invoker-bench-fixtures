import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_PASSWORD_BYTES = 1024;

declare const userIdBrand: unique symbol;
declare const usernameBrand: unique symbol;
declare const passwordHashBrand: unique symbol;
declare const sessionTokenBrand: unique symbol;

export type UserId = string & { readonly [userIdBrand]: true };
export type Username = string & { readonly [usernameBrand]: true };
export type PasswordHash = string & { readonly [passwordHashBrand]: true };
/** Bearer credential; store and transmit only over a protected channel. */
export type SessionToken = string & { readonly [sessionTokenBrand]: true };

export function createUserId(value: unknown): UserId {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("User id must be a non-empty string");
  }
  return value.trim() as UserId;
}

export function createUsername(value: unknown): Username {
  if (typeof value !== "string") throw new TypeError("Username must be a string");
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(normalized)) {
    throw new TypeError("Username must be 3-32 characters using letters, numbers, or underscores");
  }
  return normalized as Username;
}

export function createSessionToken(value: unknown): SessionToken {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new TypeError("Session token must be a 32-byte base64url token");
  }
  return value as SessionToken;
}

export function generateSessionToken(): SessionToken {
  return createSessionToken(randomBytes(32).toString("base64url"));
}

/** Hash a password using scrypt with a fresh random salt. */
export async function hashPassword(password: string): Promise<PasswordHash> {
  validatePassword(password);
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  return `$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}` as PasswordHash;
}

/** Return false for malformed hashes or passwords that violate input limits. */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    validatePassword(password);
    const match = /^\$scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encodedHash);
    if (!match) return false;
    const [, nText, rText, pText, saltText, keyText] = match;
    const n = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    // Bound parameters before invoking scrypt so untrusted stored values cannot request excessive work.
    if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P || salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;
    const actual = (await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    })) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("Password must be a non-empty string");
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new RangeError(`Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes`);
  }
}
