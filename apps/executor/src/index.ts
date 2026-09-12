import "dotenv/config";
import Fastify from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { generateCppHarness } from "./harness/cpp.js";
import type { TestCase } from "@cpd/core";
import { generatePythonRunner } from "./harness/python.js";
import { generateRustHarness } from "./harness/rust.js";
import { generateCHarness } from "./harness/c.js";
import { generateBashHarness } from "./harness/bash.js";
import { generateJsHarness } from "./harness/js.js";
import { generateAsmHarness } from "./harness/asm.js";
import { generateSqlHarness } from "./harness/sql.js";
import { createWorkdir, pickRunner, type SandboxOpts } from "./sandbox/index.js";

const execFileAsync = promisify(execFile);

const executeRequestSchema = z.object({
  language: z.enum(["cpp", "python", "rust", "c", "bash", "js", "asm", "sql"]),
  code: z.string().min(1).max(200_000),
  harness: z.object({
    language: z.enum(["cpp", "python", "rust", "c", "bash", "js", "asm", "sql"]),
    entryFn: z.string(),
    args: z.union([z.array(z.unknown()), z.literal("auto")]),
    comparator: z.enum(["exact", "float", "array", "array_float", "map"]),
    schema: z.string().optional(),
    verificationQuery: z.string().optional(),
    argTypes: z.array(z.string()).optional(),
    returnType: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    memoryMb: z.number().int().positive().optional()
  }),
  testCases: z
    .array(
      z.object({
        input: z.unknown(),
        expected: z.unknown(),
        description: z.string().optional()
      })
    )
    .min(1)
    .max(50),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  memoryMb: z.number().int().positive().max(512).optional()
});

export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

export interface ExecuteResponse {
  status: "PASS" | "FAIL" | "COMPILE_ERROR" | "TIMEOUT" | "RUNTIME_ERROR" | "EXECUTOR_ERROR";
  results: { index: number; passed: boolean; description?: string; expected?: unknown; actual?: unknown; stderr?: string }[];
  compileError?: string;
  stdout?: string;
  stderr?: string;
  durationMs: number;
  sandboxMethod: string;
}

const DOCKER_IMAGES: Record<string, string> = {
  cpp: process.env.EXECUTOR_DOCKER_IMAGE_CPP ?? "gcc:latest",
  c: process.env.EXECUTOR_DOCKER_IMAGE_C ?? "gcc:latest",
  python: process.env.EXECUTOR_DOCKER_IMAGE_PYTHON ?? "python:3.12-alpine",
  rust: process.env.EXECUTOR_DOCKER_IMAGE_RUST ?? "rust:1-alpine",
  bash: process.env.EXECUTOR_DOCKER_IMAGE_BASH ?? "bash:latest",
  js: process.env.EXECUTOR_DOCKER_IMAGE_JS ?? "node:22-alpine",
  asm: process.env.EXECUTOR_DOCKER_IMAGE_ASM ?? "gcc:latest",
  sql: process.env.EXECUTOR_DOCKER_IMAGE_SQL ?? "python:3.12-alpine"
};

const LOCAL_COMPILE_CMD: Record<string, string> = {
  cpp: "g++ -std=c++20 -O1 -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer -o prog main.cpp",
  c: "gcc -std=c11 -O1 -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer -o prog main.c",
  python: "python3 -B -c \"import ast; ast.parse(open('runner.py').read())\"",
  rust: "rustc -O -o prog main.rs",
  bash: "bash -n runner.sh",
  js: "node --check runner.js",
  asm: "gcc -O1 -o prog main.c func.s",
  sql: "python3 -c \"import sqlite3; sqlite3.connect(':memory:')\""
};

interface BuiltFiles {
  files: Record<string, string>;
  compileCmd: string;
  runCmd: string;
}

function buildFiles(language: string, code: string, req: ExecuteRequest): BuiltFiles {
  if (language === "cpp") {
    const { main, compileCmd, runCmd } = generateCppHarness(code, req.harness, req.testCases as TestCase[]);
    return { files: { "main.cpp": main }, compileCmd, runCmd };
  }
  if (language === "c") {
    const { main, compileCmd, runCmd } = generateCHarness(code, req.harness, req.testCases as TestCase[]);
    return { files: { "main.c": main }, compileCmd, runCmd };
  }
  if (language === "rust") {
    const { main, compileCmd, runCmd } = generateRustHarness(code, req.harness, req.testCases as TestCase[]);
    return { files: { "main.rs": main }, compileCmd, runCmd };
  }
  if (language === "bash") {
    const { main, compileCmd, runCmd } = generateBashHarness(code, req.harness, req.testCases as TestCase[]);
    return { files: { "runner.sh": main }, compileCmd, runCmd };
  }
  if (language === "js") {
    const { main, compileCmd, runCmd } = generateJsHarness(code, req.harness, req.testCases as TestCase[]);
    return { files: { "runner.js": main }, compileCmd, runCmd };
  }
  if (language === "asm") {
    const { main, compileCmd, runCmd } = generateAsmHarness(code, req.harness, req.testCases as TestCase[]);
    return { files: { "main.c": main, "func.s": code }, compileCmd, runCmd };
  }
  if (language === "sql") {
    const { main, compileCmd, runCmd } = generateSqlHarness(code, req.harness, req.testCases as TestCase[]);
    return { files: { "runner.py": main, "schema.sql": req.harness.schema ?? "", "solution.sql": code }, compileCmd, runCmd };
  }
  const { main, runCmd } = generatePythonRunner(code, req.harness, req.testCases as TestCase[]);
  return { files: { "runner.py": main }, compileCmd: LOCAL_COMPILE_CMD.python!, runCmd };
}

function parseResults(stdout: string): ExecuteResponse["results"] {
  const results: ExecuteResponse["results"] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const idx = line.indexOf("|");
    if (idx < 0) continue;
    const status = line.slice(0, idx);
    const rest = line.slice(idx + 1);
    const parts = rest.split("|");
    if (status === "P" || status === "F") {
      results.push({
        index: results.length,
        passed: status === "P",
        description: parts[0],
        expected: parts[1],
        actual: parts[2]
      });
    } else if (status === "E") {
      results.push({ index: results.length, passed: false, description: parts[0], stderr: parts[1] });
    }
  }
  return results;
}

async function execute(req: ExecuteRequest): Promise<ExecuteResponse> {
  const language = req.language;
  const timeoutMs = req.harness.timeoutMs ?? req.timeoutMs ?? 5000;
  const memoryMb = req.harness.memoryMb ?? req.memoryMb ?? 512;
  const useDocker = process.env.EXECUTOR_USE_DOCKER !== "false";
  const runtime = process.env.EXECUTOR_DOCKER_RUNTIME || undefined;
  const image = DOCKER_IMAGES[language] ?? "alpine";
  if (useDocker) await ensureImage(image);
  const runner = pickRunner(useDocker, image, runtime);

  const files = buildFiles(language, req.code, req);
  const work = await createWorkdir(files.files);

  const opts: SandboxOpts = { timeoutMs, memoryMb };

  try {
    // step 1: compile/check
    const compileRes = await runner.run(work.dir, [files.compileCmd], opts);
    if (compileRes.exitCode !== 0) {
      return {
        status: "COMPILE_ERROR",
        results: [],
        compileError: compileRes.stderr || compileRes.stdout,
        stderr: compileRes.stderr,
        stdout: compileRes.stdout,
        durationMs: compileRes.durationMs,
        sandboxMethod: runner.method
      };
    }

    // step 2: run
    const runRes = await runner.run(work.dir, [files.runCmd], { ...opts, timeoutMs });
    const results = parseResults(runRes.stdout);
    const allPassed = results.length > 0 && results.every((r) => r.passed);
    const anyError = results.some((r) => r.stderr);

    let status: ExecuteResponse["status"] = "PASS";
    if (runRes.timedOut) status = "TIMEOUT";
    else if (results.length === 0 && runRes.exitCode !== 0) status = "RUNTIME_ERROR";
    else if (anyError) status = "RUNTIME_ERROR";
    else if (!allPassed) status = "FAIL";

    return {
      status,
      results,
      stderr: runRes.stderr,
      stdout: runRes.stdout,
      durationMs: runRes.durationMs,
      sandboxMethod: runner.method
    };
  } finally {
    await work.cleanup();
  }
}

export async function ensureImages(): Promise<void> {
  if (process.env.EXECUTOR_USE_DOCKER === "false") return;
  const pulled = new Set<string>();
  const pull = async (image: string) => {
    if (pulled.has(image)) return;
    try {
      await execFileAsync("docker", ["image", "inspect", image]);
      pulled.add(image);
      return;
    } catch {
      // not present locally — pull in background
    }
    pulled.add(image);
    console.log(`[executor] pulling image ${image}`);
    execFileAsync("docker", ["pull", image], { timeout: 900_000 }).catch((err) => {
      console.error(`[executor] pull failed for ${image}: ${err.message ?? err}`);
    });
  };
  for (const image of new Set(Object.values(DOCKER_IMAGES))) {
    void pull(image);
  }
}

export async function ensureImage(image: string): Promise<void> {
  if (process.env.EXECUTOR_USE_DOCKER === "false") return;
  try {
    await execFileAsync("docker", ["image", "inspect", image]);
    return;
  } catch {
    console.log(`[executor] pulling image ${image} (on demand)`);
    await execFileAsync("docker", ["pull", image], { timeout: 900_000 });
  }
}

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  app.get("/health", async () => {
    const useDocker = process.env.EXECUTOR_USE_DOCKER !== "false";
    const runtime = process.env.EXECUTOR_DOCKER_RUNTIME;
    const method = !useDocker ? "local" : runtime === "runsc" ? "docker-gvisor" : "docker";
    return { ok: true, method, runtime: runtime ?? "runc" };
  });

  app.post("/execute", async (request, reply) => {
    const parsed = executeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    if (parsed.data.harness.language !== parsed.data.language) {
      return reply.code(400).send({ error: "harness_language_mismatch" });
    }
    try {
      return await execute(parsed.data);
    } catch (err) {
      request.log.error({ err }, "execution failed");
      return reply.code(500).send({
        status: "EXECUTOR_ERROR",
        results: [],
        error: err instanceof Error ? err.message : "unknown executor error"
      });
    }
  });

  return app;
}

if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  const port = Number(process.env.EXECUTOR_PORT ?? 4100);
  ensureImages()
    .then(() => buildServer())
    .then((app) => app.listen({ port, host: "0.0.0.0" }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}