const CUSTOM_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

export function isValidAbsoluteHttpUrl(value) {
  if (typeof value !== "string" || !ABSOLUTE_HTTP_URL_PATTERN.test(value)) return false;
  try {
    const parsedUrl = new URL(value);
    return ALLOWED_URL_PROTOCOLS.has(parsedUrl.protocol) && parsedUrl.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isValidCustomCode(value) {
  return typeof value === "string" && CUSTOM_CODE_PATTERN.test(value);
}
