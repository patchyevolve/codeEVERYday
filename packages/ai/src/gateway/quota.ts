import { priorityRank, type Priority } from "../contracts.js";

const PRIORITY_FLOOR = 0.2;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

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
  now: number,
): ProviderQuota {
  return {
    rpm: { used: 0, limit: rpm, windowStart: now },
    tpm: { used: 0, limit: tpm, windowStart: now },
    rpd: { used: 0, limit: rpd, windowStart: now },
    tpd: { used: 0, limit: tpd, windowStart: now },
    reservedFloor: {
      requests: Math.ceil(rpd * PRIORITY_FLOOR),
      tokens: Math.ceil(tpd * PRIORITY_FLOOR),
    },
  };
}

function isBackground(priority: Priority): boolean {
  return priorityRank(priority) >= priorityRank("P3");
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
    limits: { rpm: number; tpm: number; rpd: number; tpd: number },
  ): void {
    if (!this.providers.has(id)) {
      this.providers.set(
        id,
        createEmptyProviderQuota(
          limits.rpm,
          limits.tpm,
          limits.rpd,
          limits.tpd,
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
  } {
    const q = this.getProvider(providerId);
    return {
      rpm: { used: q.rpm.used, limit: q.rpm.limit },
      rpd: { used: q.rpd.used, limit: q.rpd.limit },
      tpm: { used: q.tpm.used, limit: q.tpm.limit },
      tpd: { used: q.tpd.used, limit: q.tpd.limit },
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

    if (isBackground(priority)) {
      if (q.rpd.used >= q.reservedFloor.requests) return false;

      const tokenLimit = estimatedTokens ?? 1;
      if (q.tpd.used + tokenLimit > q.tpd.limit) return false;
      if (q.tpd.used + tokenLimit > q.reservedFloor.tokens) return false;
    } else {
      if (estimatedTokens !== undefined) {
        if (q.tpm.used + estimatedTokens > q.tpm.limit) return false;
        if (q.tpd.used + estimatedTokens > q.tpd.limit) return false;
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

    if (isBackground(priority)) {
      if (q.rpd.used >= q.reservedFloor.requests) return false;
      if (q.tpd.used + tokensUsed > q.tpd.limit) return false;
      if (q.tpd.used + tokensUsed > q.reservedFloor.tokens) return false;
    } else {
      if (q.tpm.used + tokensUsed > q.tpm.limit) return false;
      if (q.tpd.used + tokensUsed > q.tpd.limit) return false;
    }

    q.rpm.used++;
    q.rpd.used++;
    q.tpm.used += tokensUsed;
    q.tpd.used += tokensUsed;
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
  }

  recordUsage(
    providerId: string,
    tokensIn: number,
    tokensOut: number,
  ): void {
    const total = tokensIn + tokensOut;
    const q = this.getProvider(providerId);
    q.tpm.used += total;
    q.tpd.used += total;
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

  loadFromDB(
    state: { requestsToday: number; tokensToday: number }[],
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
  }
}
