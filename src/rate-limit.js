const MINIMUM_RETRY_AFTER_SECONDS = 1;
const MILLISECONDS_PER_SECOND = 1000;

export function createRateLimiter({ maxRequests, windowMs, now }) {
  const requestCountsByIp = new Map();

  return function rateLimit(clientIp) {
    const currentTime = now();
    const windowStart = Math.floor(currentTime / windowMs) * windowMs;
    const entry = requestCountsByIp.get(clientIp);

    if (!entry || entry.windowStart !== windowStart) {
      requestCountsByIp.set(clientIp, { windowStart, count: 1 });
      return { limited: false };
    }

    if (entry.count >= maxRequests) {
      const remainingMs = windowStart + windowMs - currentTime;
      const retryAfterSeconds = Math.max(
        MINIMUM_RETRY_AFTER_SECONDS,
        Math.ceil(remainingMs / MILLISECONDS_PER_SECOND),
      );
      return { limited: true, retryAfterSeconds };
    }

    entry.count += 1;
    return { limited: false };
  };
}
