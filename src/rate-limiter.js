export class RateLimiter {
  constructor({ maxRequests, windowMs, now }) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.now = now;
    this.windows = new Map();
  }

  isAllowed(clientId) {
    const nowMs = this.now();
    const currentWindowStart = Math.floor(nowMs / this.windowMs) * this.windowMs;
    const windowEntry = this.windows.get(clientId);

    if (!windowEntry || windowEntry.resetAt <= nowMs) {
      this.windows.set(clientId, { count: 1, resetAt: currentWindowStart + this.windowMs });
      return { allowed: true };
    }

    if (windowEntry.count >= this.maxRequests) {
      const retryAfterSeconds = Math.max(MINIMUM_RETRY_AFTER_SECONDS, Math.ceil((windowEntry.resetAt - nowMs) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    windowEntry.count += 1;
    return { allowed: true };
  }
}

const MINIMUM_RETRY_AFTER_SECONDS = 1;
