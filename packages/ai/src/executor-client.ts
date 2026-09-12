/**
 * HTTP client for the sandboxed code-execution service.
 */

import type { Harness, TestCase } from "@cpd/core";
import type { ExecutorLanguage } from "@cpd/core";

export interface ExecutorResult {
  status: "PASS" | "FAIL" | "COMPILE_ERROR" | "TIMEOUT" | "RUNTIME_ERROR" | "EXECUTOR_ERROR";
  results: { index: number; passed: boolean; description?: string; expected?: unknown; actual?: unknown; stderr?: string }[];
  compileError?: string;
  stdout?: string;
  stderr?: string;
  durationMs: number;
  sandboxMethod: string;
  error?: string;
}

export function executorUrl(): string {
  return process.env.EXECUTOR_URL ?? "http://localhost:4100";
}

export async function executeCode(
  language: ExecutorLanguage,
  code: string,
  harness: Harness,
  testCases: TestCase[],
  timeoutMs?: number,
  memoryMb?: number
): Promise<ExecutorResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${executorUrl()}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, code, harness, testCases, timeoutMs, memoryMb }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Executor HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as ExecutorResult;
  } catch (err) {
    return {
      status: "EXECUTOR_ERROR",
      results: [],
      error: err instanceof Error ? err.message : "executor unreachable",
      durationMs: 0,
      sandboxMethod: "none"
    };
  } finally {
    clearTimeout(t);
  }
}

export async function executorHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${executorUrl()}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}