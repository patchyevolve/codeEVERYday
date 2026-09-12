interface SlidingWindow {
  timestamps: number[];
  tokens: number[];
}

interface ProviderRateLimit {
  rpmWindow: SlidingWindow;
  tpmWindow: SlidingWindow;
}

const ONE_MINUTE = 60_000;

export class RateLimiter {
  private readonly providers = new Map<string, ProviderRateLimit>();

  checkRateLimit(
    providerId: string,
    rpmLimit: number,
    tpmLimit: number,
  ): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const window = this.getOrCreate(providerId);

    this.prune(window.rpmWindow, now);
    this.pruneTokens(window.tpmWindow, now);

    const currentRpm = window.rpmWindow.timestamps.length;
    const currentTpm = window.tpmWindow.tokens.reduce((a, b) => a + b, 0);

    let retryAfterMs = 0;

    if (currentRpm >= rpmLimit && window.rpmWindow.timestamps.length > 0) {
      const oldest = window.rpmWindow.timestamps[0]!;
      retryAfterMs = Math.max(retryAfterMs, oldest + ONE_MINUTE - now);
    }

    if (currentTpm >= tpmLimit && window.tpmWindow.timestamps.length > 0) {
      const oldestTs = window.tpmWindow.timestamps[0]!;
      retryAfterMs = Math.max(retryAfterMs, oldestTs + ONE_MINUTE - now);
    }

    if (retryAfterMs > 0) {
      return { allowed: false, retryAfterMs };
    }

    return { allowed: true, retryAfterMs: 0 };
  }

  recordRequest(providerId: string, tokens: number): void {
    const now = Date.now();
    const window = this.getOrCreate(providerId);

    this.prune(window.rpmWindow, now);
    this.pruneTokens(window.tpmWindow, now);

    window.rpmWindow.timestamps.push(now);
    window.tpmWindow.timestamps.push(now);
    window.tpmWindow.tokens.push(tokens);
  }

  getUsage(providerId: string): { rpm: number; tpm: number } {
    const now = Date.now();
    const window = this.getOrCreate(providerId);

    this.prune(window.rpmWindow, now);
    this.pruneTokens(window.tpmWindow, now);

    return {
      rpm: window.rpmWindow.timestamps.length,
      tpm: window.tpmWindow.tokens.reduce((a, b) => a + b, 0),
    };
  }

  reset(): void {
    this.providers.clear();
  }

  private getOrCreate(providerId: string): ProviderRateLimit {
    let limit = this.providers.get(providerId);
    if (!limit) {
      limit = {
        rpmWindow: { timestamps: [], tokens: [] },
        tpmWindow: { timestamps: [], tokens: [] },
      };
      this.providers.set(providerId, limit);
    }
    return limit;
  }

  private prune(window: SlidingWindow, now: number): void {
    const cutoff = now - ONE_MINUTE;
    while (window.timestamps.length > 0 && window.timestamps[0]! < cutoff) {
      window.timestamps.shift();
    }
  }

  private pruneTokens(window: SlidingWindow, now: number): void {
    const cutoff = now - ONE_MINUTE;
    while (window.timestamps.length > 0 && window.timestamps[0]! < cutoff) {
      window.timestamps.shift();
      window.tokens.shift();
    }
  }
}
