import "dotenv/config";
import { buildApp, serverHealth } from "./app.js";

const requiredEnvVars = ["DATABASE_URL", "API_SESSION_SECRET"] as const;
for (const v of requiredEnvVars) {
  if (!process.env[v]) {
    console.error(`FATAL: missing required env var ${v}`);
    process.exit(1);
  }
}

const port = Number(process.env.API_PORT ?? 4000);
const drainMs = Number(process.env.API_DRAIN_TIMEOUT_MS ?? 15_000);
// Hold the listener open briefly after /ready starts returning 503 so a
// polling load balancer can actually observe the drain and stop routing
// new connections before the socket closes.
const drainDelayMs = Number(process.env.API_DRAIN_DELAY_MS ?? 500);

const app = await buildApp({ logger: true });
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`api listening on :${port}`);

/**
 * Graceful drain: flip readiness first so /ready reports 503 and a load
 * balancer stops routing new traffic, then let Fastify finish in-flight
 * requests and close the pool before exiting.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(
    `${signal} received — draining (observe 503 for ${drainDelayMs}ms, max ${drainMs}ms total)`,
  );
  serverHealth.ready = false;

  const forced = setTimeout(() => {
    app.log.error(`drain exceeded ${drainMs}ms — exiting without waiting`);
    process.exit(1);
  }, drainMs);
  forced.unref();

  // Keep accepting connections while /ready reports 503 so a polling load
  // balancer can take this instance out of rotation before we stop listening.
  if (drainDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, drainDelayMs));
  }

  try {
    await app.close();
    app.log.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
