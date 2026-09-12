import { execFile } from "node:child_process";
import { chmod, mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  sandboxMethod: string;
  durationMs: number;
}

export interface SandboxOpts {
  timeoutMs: number;
  memoryMb: number;
  cpus?: number;
  maxOutputBytes?: number;
}

export interface WorkdirHandle {
  dir: string;
  cleanup(): Promise<void>;
}

export async function createWorkdir(files: Record<string, string>): Promise<WorkdirHandle> {
  const dir = await mkdtemp(join(tmpdir(), "cpd-exec-"));
  await chmod(dir, 0o777);
  for (const [name, content] of Object.entries(files)) {
    const parent = name.includes("/") ? join(dir, name.split("/").slice(0, -1).join("/")) : dir;
    if (parent !== dir) await mkdir(parent, { recursive: true });
    const file = join(dir, name);
    await writeFile(file, content);
    await chmod(file, 0o644);
  }
  return {
    dir,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        await chmod(dir, 0o777).catch(() => {});
        await execFileAsync("chmod", ["-R", "a+rwX", dir]).catch(() => {});
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  };
}

/** Docker sandbox: network-none, resource-limited, read-only rootfs,
 *  non-root uid, all capabilities dropped, tmpfs for /tmp.
 *  Optional runtime: "runsc" for gVisor sandboxing. */
export async function runDocker(
  image: string,
  workdir: string,
  cmd: string[],
  opts: SandboxOpts,
  runtime?: string,
): Promise<SandboxResult> {
  const started = Date.now();
  const args = [
    "run",
    "--rm",
    "--network", "none",
    "--memory", `${opts.memoryMb}m`,
    "--memory-swap", `${opts.memoryMb}m`,
    "--cpus", String(opts.cpus ?? 1),
    "--pids-limit", "128",
    "--read-only",
    "--tmpfs", "/tmp:size=64m,noexec,nosuid",
    "--user", "65534:65534",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--env", "PATH=/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "--env", "HOME=/tmp",
    "--volume", `${workdir}:/work:rw`,
    "--workdir", "/work",
  ];

  if (runtime) {
    args.push("--runtime", runtime);
  }

  args.push(image, "sh", "-c", `ulimit -f 262144; ulimit -n 64; ${cmd.join(" && ")}`);

  const method = runtime === "runsc" ? "docker-gvisor" : "docker";
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
      timeout: opts.timeoutMs + 15_000,
      maxBuffer: opts.maxOutputBytes ?? 2_000_000
    });
    return {
      stdout,
      stderr,
      exitCode: 0,
      timedOut: false,
      sandboxMethod: method,
      durationMs: Date.now() - started
    };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
      timedOut: !!e.killed,
      sandboxMethod: method,
      durationMs: Date.now() - started
    };
  }
}

/** Local sandbox via bubblewrap (user namespaces) with prlimit + timeout. */
export async function runBwrap(
  cmds: string[],
  opts: SandboxOpts
): Promise<SandboxResult> {
  const started = Date.now();
  const script = `ulimit -f 262144; ulimit -n 64; ulimit -u 64; ulimit -t ${Math.ceil(opts.timeoutMs / 1000) + 2}; ${cmds.join(" && ")}`;
  const args = [
    "--die-with-parent",
    "--unshare-all",
    "--new-session",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", "/etc", "/etc",
    "--bind", "/work", "/work",
    "--tmpfs", "/tmp",
    "--setenv", "PATH", "/usr/bin:/bin",
    "--setenv", "HOME", "/tmp",
    "--chdir", "/work",
    "--unshare-pid",
    "/bin/sh", "-c", script
  ];
  // bwrap needs a bind-mounted work dir under a stable path
  try {
    const { stdout, stderr } = await execFileAsync("bwrap", args, {
      timeout: opts.timeoutMs + 15_000,
      maxBuffer: opts.maxOutputBytes ?? 2_000_000
    });
    return { stdout, stderr, exitCode: 0, timedOut: false, sandboxMethod: "bwrap", durationMs: Date.now() - started };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
      timedOut: !!e.killed,
      sandboxMethod: "bwrap",
      durationMs: Date.now() - started
    };
  }
}

/** Last-resort local process sandbox: prlimit + timeout, cwd isolated. */
export async function runPlain(
  workdir: string,
  cmds: string[],
  opts: SandboxOpts
): Promise<SandboxResult> {
  const started = Date.now();
  const script = `ulimit -f 262144; ulimit -n 64; ulimit -u 64; ulimit -t ${Math.ceil(opts.timeoutMs / 1000) + 2}; ${cmds.join(" && ")}`;
  try {
    const { stdout, stderr } = await execFileAsync("prlimit", [
      `--as=${opts.memoryMb * 1024 * 1024}`,
      "--nofile=64",
      "--nproc=64",
      "--fsize=4096",
      "sh",
      "-c",
      script
    ], {
      cwd: workdir,
      timeout: opts.timeoutMs + 15_000,
      maxBuffer: opts.maxOutputBytes ?? 2_000_000,
      env: { PATH: "/usr/bin:/bin", HOME: workdir }
    });
    return { stdout, stderr, exitCode: 0, timedOut: false, sandboxMethod: "plain", durationMs: Date.now() - started };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
      timedOut: !!e.killed,
      sandboxMethod: "plain",
      durationMs: Date.now() - started
    };
  }
}

export interface SandboxRunner {
  method: "docker" | "docker-gvisor" | "bwrap" | "plain";
  run(workdir: string, cmds: string[], opts: SandboxOpts): Promise<SandboxResult>;
}

export function pickRunner(useDocker: boolean, image: string, runtime?: string): SandboxRunner {
  if (useDocker) {
    if (runtime === "runsc") {
      return { method: "docker-gvisor", run: (w, c, o) => runDocker(image, w, c, o, "runsc") };
    }
    return { method: "docker", run: (w, c, o) => runDocker(image, w, c, o) };
  }
  return { method: "plain", run: (w, c, o) => runPlain(w, c, o) };
}