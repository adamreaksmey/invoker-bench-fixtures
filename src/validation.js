const CUSTOM_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";

export function isAbsoluteHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === HTTP_PROTOCOL || parsed.protocol === HTTPS_PROTOCOL;
  } catch {
    return false;
  }
}

export function isValidCustomCode(code) {
  return typeof code === "string" && CUSTOM_CODE_PATTERN.test(code);
}
