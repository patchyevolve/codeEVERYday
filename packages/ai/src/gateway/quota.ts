import { priorityRank, type Priority } from "../contracts.js";

const PRIORITY_FLOOR = 0.2;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS; // approximate; reset logic uses calendar month

interface WindowCounters {
  used: number;
  limit: number;
  windowStart: number;
}

interface ProviderQuota {
  rpm: WindowCounters;
  tpm: WindowCounters;
  rpd: WindowCounters;
  tpd: WindowCounters;
  monthlyRequests: WindowCounters;
  monthlyTokens: WindowCounters;
  monthlyCostUsd: number;
  monthlyResetAt: number;
  reservedFloor: {
    requests: number;
    tokens: number;
  };
}

function createEmptyProviderQuota(
  rpm: number,
  tpm: number,
  rpd: number,
  tpd: number,
  monthlyRpd: number,
  monthlyTpd: number,
  now: number,
): ProviderQuota {
  const monthStart = getMonthStart(now);
  return {
    rpm: { used: 0, limit: rpm, windowStart: now },
    tpm: { used: 0, limit: tpm, windowStart: now },
    rpd: { used: 0, limit: rpd, windowStart: now },
    tpd: { used: 0, limit: tpd, windowStart: now },
    monthlyRequests: { used: 0, limit: monthlyRpd, windowStart: monthStart },
    monthlyTokens: { used: 0, limit: monthlyTpd, windowStart: monthStart },
    monthlyCostUsd: 0,
    monthlyResetAt: getNextMonthStart(now),
    reservedFloor: {
      requests: Math.ceil(rpd * PRIORITY_FLOOR),
      tokens: Math.ceil(tpd * PRIORITY_FLOOR),
    },
  };
}

function isBackground(priority: Priority): boolean {
  return priorityRank(priority) >= priorityRank("P3");
}

/**
 * Get the start of the current month (UTC) as a timestamp.
 */
function getMonthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

/**
 * Get the start of the next month (UTC) as a timestamp.
 */
function getNextMonthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
}

function resetMinuteWindow(w: WindowCounters, now: number): boolean {
  if (now - w.windowStart >= MINUTE_MS) {
    w.used = 0;
    w.windowStart = now;
    return true;
  }
  return false;
}

function resetDayWindow(w: WindowCounters, now: number): boolean {
  if (now - w.windowStart >= DAY_MS) {
    w.used = 0;
    w.windowStart = now;
    return true;
  }
  return false;
}

export class QuotaManager {
  private providers = new Map<string, ProviderQuota>();

  registerProvider(
    id: string,
    limits: {
      rpm: number;
      tpm: number;
      rpd: number;
      tpd: number;
      monthlyRpd?: number;
      monthlyTpd?: number;
    },
  ): void {
    if (!this.providers.has(id)) {
      this.providers.set(
        id,
        createEmptyProviderQuota(
          limits.rpm,
          limits.tpm,
          limits.rpd,
          limits.tpd,
          limits.monthlyRpd ?? Infinity,
          limits.monthlyTpd ?? Infinity,
          Date.now(),
        ),
      );
    }
  }

  getQuotaStatus(providerId: string): {
    rpm: { used: number; limit: number };
    rpd: { used: number; limit: number };
    tpm: { used: number; limit: number };
    tpd: { used: number; limit: number };
    monthlyRequests: { used: number; limit: number };
    monthlyTokens: { used: number; limit: number };
    monthlyCostUsd: number;
    monthlyResetAt: Date;
  } {
    const q = this.getProvider(providerId);
    return {
      rpm: { used: q.rpm.used, limit: q.rpm.limit },
      rpd: { used: q.rpd.used, limit: q.rpd.limit },
      tpm: { used: q.tpm.used, limit: q.tpm.limit },
      tpd: { used: q.tpd.used, limit: q.tpd.limit },
      monthlyRequests: { used: q.monthlyRequests.used, limit: q.monthlyRequests.limit },
      monthlyTokens: { used: q.monthlyTokens.used, limit: q.monthlyTokens.limit },
      monthlyCostUsd: q.monthlyCostUsd,
      monthlyResetAt: new Date(q.monthlyResetAt),
    };
  }

  canReserve(
    providerId: string,
    priority: Priority,
    estimatedTokens?: number,
  ): boolean {
    const q = this.getProvider(providerId);
    const now = Date.now();
    this.tickWindows(q, now);

    if (q.rpm.used >= q.rpm.limit) return false;
    if (q.rpd.used >= q.rpd.limit) return false;
    if (q.monthlyRequests.used >= q.monthlyRequests.limit) return false;

    if (isBackground(priority)) {
      if (q.rpd.used >= q.reservedFloor.requests) return false;

      const tokenLimit = estimatedTokens ?? 1;
      if (q.tpd.used + tokenLimit > q.tpd.limit) return false;
      if (q.tpd.used + tokenLimit > q.reservedFloor.tokens) return false;
      if (q.monthlyTokens.used + tokenLimit > q.monthlyTokens.limit) return false;
    } else {
      if (estimatedTokens !== undefined) {
        if (q.tpm.used + estimatedTokens > q.tpm.limit) return false;
        if (q.tpd.used + estimatedTokens > q.tpd.limit) return false;
        if (q.monthlyTokens.used + estimatedTokens > q.monthlyTokens.limit) return false;
      }
    }

    return true;
  }

  reserve(
    providerId: string,
    priority: Priority,
    tokensUsed: number,
  ): boolean {
    const q = this.getProvider(providerId);
    const now = Date.now();
    this.tickWindows(q, now);

    if (q.rpm.used >= q.rpm.limit) return false;
    if (q.rpd.used >= q.rpd.limit) return false;
    if (q.monthlyRequests.used >= q.monthlyRequests.limit) return false;

    if (isBackground(priority)) {
      if (q.rpd.used >= q.reservedFloor.requests) return false;
      if (q.tpd.used + tokensUsed > q.tpd.limit) return false;
      if (q.tpd.used + tokensUsed > q.reservedFloor.tokens) return false;
      if (q.monthlyTokens.used + tokensUsed > q.monthlyTokens.limit) return false;
    } else {
      if (q.tpm.used + tokensUsed > q.tpm.limit) return false;
      if (q.tpd.used + tokensUsed > q.tpd.limit) return false;
      if (q.monthlyTokens.used + tokensUsed > q.monthlyTokens.limit) return false;
    }

    q.rpm.used++;
    q.rpd.used++;
    q.tpm.used += tokensUsed;
    q.tpd.used += tokensUsed;
    q.monthlyRequests.used++;
    q.monthlyTokens.used += tokensUsed;
    return true;
  }

  release(
    providerId: string,
    priority: Priority,
    tokensUsed: number,
  ): void {
    const q = this.getProvider(providerId);
    q.rpm.used = Math.max(0, q.rpm.used - 1);
    q.rpd.used = Math.max(0, q.rpd.used - 1);
    q.tpm.used = Math.max(0, q.tpm.used - tokensUsed);
    q.tpd.used = Math.max(0, q.tpd.used - tokensUsed);
    q.monthlyRequests.used = Math.max(0, q.monthlyRequests.used - 1);
    q.monthlyTokens.used = Math.max(0, q.monthlyTokens.used - tokensUsed);
  }

  recordUsage(
    providerId: string,
    tokensIn: number,
    tokensOut: number,
    costUsd = 0,
  ): void {
    const total = tokensIn + tokensOut;
    const q = this.getProvider(providerId);
    q.tpm.used += total;
    q.tpd.used += total;
    q.monthlyTokens.used += total;
    q.monthlyCostUsd += costUsd;
  }

  resetDaily(providerId: string): void {
    const q = this.getProvider(providerId);
    q.rpd.used = 0;
    q.rpd.windowStart = Date.now();
    q.tpd.used = 0;
    q.tpd.windowStart = Date.now();
    q.reservedFloor.requests = Math.ceil(q.rpd.limit * PRIORITY_FLOOR);
    q.reservedFloor.tokens = Math.ceil(q.tpd.limit * PRIORITY_FLOOR);
  }

  /**
   * Reset monthly quota counters. Called on the 1st of each month or
   * when the monthly window has expired.
   */
  resetMonthly(providerId: string): void {
    const q = this.getProvider(providerId);
    const now = Date.now();
    const monthStart = getMonthStart(now);
    q.monthlyRequests.used = 0;
    q.monthlyRequests.windowStart = monthStart;
    q.monthlyTokens.used = 0;
    q.monthlyTokens.windowStart = monthStart;
    q.monthlyCostUsd = 0;
    q.monthlyResetAt = getNextMonthStart(now);
  }

  /**
   * Get current monthly usage for a provider.
   */
  getMonthlyUsage(providerId: string): {
    requests: { used: number; limit: number };
    tokens: { used: number; limit: number };
    costUsd: number;
    resetAt: Date;
  } {
    const q = this.getProvider(providerId);
    this.tickWindows(q, Date.now());
    return {
      requests: { used: q.monthlyRequests.used, limit: q.monthlyRequests.limit },
      tokens: { used: q.monthlyTokens.used, limit: q.monthlyTokens.limit },
      costUsd: q.monthlyCostUsd,
      resetAt: new Date(q.monthlyResetAt),
    };
  }

  loadFromDB(
    state: {
      requestsToday: number;
      tokensToday: number;
      requestsThisMonth?: number;
      tokensThisMonth?: number;
      costUsdThisMonth?: number;
    }[],
  ): void {
    const providers = Array.from(this.providers.keys());
    for (let i = 0; i < Math.min(state.length, providers.length); i++) {
      const key = providers[i];
      if (!key) continue;
      const q = this.providers.get(key);
      const s = state[i];
      if (q && s) {
        q.rpd.used = s.requestsToday;
        q.tpd.used = s.tokensToday;
        if (s.requestsThisMonth !== undefined) {
          q.monthlyRequests.used = s.requestsThisMonth;
        }
        if (s.tokensThisMonth !== undefined) {
          q.monthlyTokens.used = s.tokensThisMonth;
        }
        if (s.costUsdThisMonth !== undefined) {
          q.monthlyCostUsd = s.costUsdThisMonth;
        }
      }
    }
  }

  private getProvider(id: string): ProviderQuota {
    let q = this.providers.get(id);
    if (!q) {
      q = createEmptyProviderQuota(
        Infinity,
        Infinity,
        Infinity,
        Infinity,
        Infinity,
        Infinity,
        Date.now(),
      );
      this.providers.set(id, q);
    }
    return q;
  }

  private tickWindows(q: ProviderQuota, now: number): void {
    resetMinuteWindow(q.rpm, now);
    resetMinuteWindow(q.tpm, now);
    resetDayWindow(q.rpd, now);
    resetDayWindow(q.tpd, now);

    // Reset monthly window if we've passed into a new month
    const monthStart = getMonthStart(now);
    if (q.monthlyRequests.windowStart < monthStart) {
      q.monthlyRequests.used = 0;
      q.monthlyRequests.windowStart = monthStart;
      q.monthlyTokens.used = 0;
      q.monthlyTokens.windowStart = monthStart;
      q.monthlyCostUsd = 0;
      q.monthlyResetAt = getNextMonthStart(now);
    }
  }
}
