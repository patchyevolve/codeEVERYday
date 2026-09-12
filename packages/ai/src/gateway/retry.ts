import type { AIErrorKind } from "../contracts.js";

const DEFAULT_MAX_DELAY_MS = 30_000;
const BASE_DELAY_MS = 1_000;

/** Max retry attempts per error kind. */
const MAX_ATTEMPTS: Record<AIErrorKind, number> = {
  RATE_LIMIT: 3,
  DAILY_QUOTA_EXHAUSTED: 0,
  TOKEN_QUOTA_EXHAUSTED: 0,
  INVALID_CREDENTIALS: 0,
  INVALID_REQUEST: 0,
  PROVIDER_FAILURE: 3,
  MODEL_UNAVAILABLE: 0,
  MALFORMED_RESPONSE: 1,
  TIMEOUT: 2,
  NETWORK_FAILURE: 3,
  UNEXPECTED_CONTENT: 0,
  CACHE_MISS: 0,
  UNKNOWN: 0,
};

const NON_RETRYABLE: Set<AIErrorKind> = new Set([
  "DAILY_QUOTA_EXHAUSTED",
  "TOKEN_QUOTA_EXHAUSTED",
  "INVALID_CREDENTIALS",
  "INVALID_REQUEST",
  "MODEL_UNAVAILABLE",
  "UNEXPECTED_CONTENT",
  "CACHE_MISS",
  "UNKNOWN",
]);

function parseRetryAfter(value: string): number | null {
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

export class RetryPolicy {
  private readonly maxDelayMs: number;
  private readonly baseDelayMs: number;

  constructor(
    baseDelayMs: number = BASE_DELAY_MS,
    maxDelayMs: number = DEFAULT_MAX_DELAY_MS,
  ) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  shouldRetry(errorKind: AIErrorKind, attemptNumber: number): boolean {
    if (NON_RETRYABLE.has(errorKind)) return false;
    return attemptNumber < MAX_ATTEMPTS[errorKind];
  }

  getDelay(
    errorKind: AIErrorKind,
    attemptNumber: number,
    retryAfterHeader?: string,
  ): number {
    if (retryAfterHeader) {
      const parsed = parseRetryAfter(retryAfterHeader);
      if (parsed !== null) return Math.min(parsed, this.maxDelayMs);
    }

    const backoff = this.baseDelayMs * Math.pow(2, attemptNumber);
    const capped = Math.min(backoff, this.maxDelayMs);
    const jitterRange = capped * 0.3;
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    return Math.floor(Math.max(0, capped + jitter));
  }

  getMaxAttempts(errorKind: AIErrorKind): number {
    return MAX_ATTEMPTS[errorKind];
  }
}
