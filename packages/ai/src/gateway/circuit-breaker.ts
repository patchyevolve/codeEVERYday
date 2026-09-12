type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface ProviderBreaker {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: Date | null;
  probeInFlight: boolean;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
}

export class CircuitBreaker {
  private readonly providers = new Map<string, ProviderBreaker>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.failureThreshold = config?.failureThreshold ?? 5;
    this.cooldownMs = config?.cooldownMs ?? 30_000;
  }

  canExecute(providerId: string): boolean {
    const b = this.getOrCreate(providerId);
    switch (b.state) {
      case "CLOSED":
        return true;
      case "HALF_OPEN":
        if (!b.probeInFlight) {
          b.probeInFlight = true;
          return true;
        }
        return false;
      case "OPEN": {
        if (!b.openedAt) return false;
        if (Date.now() - b.openedAt.getTime() >= this.cooldownMs) {
          b.state = "HALF_OPEN";
          b.probeInFlight = true;
          return true;
        }
        return false;
      }
    }
  }

  recordSuccess(providerId: string): void {
    const b = this.getOrCreate(providerId);
    b.consecutiveFailures = 0;
    b.state = "CLOSED";
    b.openedAt = null;
    b.probeInFlight = false;
  }

  recordFailure(providerId: string): void {
    const b = this.getOrCreate(providerId);
    b.consecutiveFailures++;

    if (b.state === "HALF_OPEN") {
      b.state = "OPEN";
      b.openedAt = new Date();
      b.probeInFlight = false;
      return;
    }

    if (b.consecutiveFailures >= this.failureThreshold) {
      b.state = "OPEN";
      b.openedAt = new Date();
    }
  }

  getState(providerId: string): { state: BreakerState; consecutiveFailures: number; openedAt: Date | null } {
    const b = this.getOrCreate(providerId);
    return {
      state: b.state,
      consecutiveFailures: b.consecutiveFailures,
      openedAt: b.openedAt,
    };
  }

  reset(providerId: string): void {
    const b = this.getOrCreate(providerId);
    b.state = "CLOSED";
    b.consecutiveFailures = 0;
    b.openedAt = null;
    b.probeInFlight = false;
  }

  loadFromDB(
    states: { providerId: string; breakerState: string; consecutiveFailures: number; breakerOpenedAt: Date | null }[],
  ): void {
    for (const s of states) {
      const b = this.getOrCreate(s.providerId);
      b.state = s.breakerState as BreakerState;
      b.consecutiveFailures = s.consecutiveFailures;
      b.openedAt = s.breakerOpenedAt;
      b.probeInFlight = false;
    }
  }

  private getOrCreate(providerId: string): ProviderBreaker {
    let b = this.providers.get(providerId);
    if (!b) {
      b = { state: "CLOSED", consecutiveFailures: 0, openedAt: null, probeInFlight: false };
      this.providers.set(providerId, b);
    }
    return b;
  }
}
