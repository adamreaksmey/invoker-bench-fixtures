const MILLISECONDS_PER_SECOND = 1000;
const MINIMUM_RETRY_AFTER_SECONDS = 1;
const NO_RETRY_AFTER_SECONDS = 0;
const COUNTER_SWEEP_THRESHOLD = 1024;

function toWindowStartMs(currentMs, windowMs) {
  return Math.floor(currentMs / windowMs) * windowMs;
}

function toRetryAfterSeconds(remainingMs) {
  const wholeSeconds = Math.ceil(remainingMs / MILLISECONDS_PER_SECOND);
  return Math.max(MINIMUM_RETRY_AFTER_SECONDS, wholeSeconds);
}

function pruneExpiredCounters(countersByClient, currentWindowStartMs) {
  for (const [clientKey, counter] of countersByClient) {
    if (counter.windowStartMs !== currentWindowStartMs) countersByClient.delete(clientKey);
  }
}

function readCounter(countersByClient, clientKey, currentWindowStartMs) {
  const existingCounter = countersByClient.get(clientKey);
  if (existingCounter && existingCounter.windowStartMs === currentWindowStartMs) {
    return existingCounter;
  }
  const freshCounter = { windowStartMs: currentWindowStartMs, requestCount: 0 };
  countersByClient.set(clientKey, freshCounter);
  return freshCounter;
}

export function createFixedWindowRateLimiter({ max, windowMs, now }) {
  const countersByClient = new Map();

  function check(clientKey) {
    const currentMs = now();
    const currentWindowStartMs = toWindowStartMs(currentMs, windowMs);
    if (countersByClient.size >= COUNTER_SWEEP_THRESHOLD) {
      pruneExpiredCounters(countersByClient, currentWindowStartMs);
    }
    const counter = readCounter(countersByClient, clientKey, currentWindowStartMs);
    if (counter.requestCount >= max) {
      const windowEndsAtMs = currentWindowStartMs + windowMs;
      return {
        isLimited: true,
        retryAfterSeconds: toRetryAfterSeconds(windowEndsAtMs - currentMs),
      };
    }
    counter.requestCount += 1;
    return { isLimited: false, retryAfterSeconds: NO_RETRY_AFTER_SECONDS };
  }

  return { check };
}
