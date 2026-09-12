import "dotenv/config";
import { buildApp } from "./app.js";

const requiredEnvVars = ["DATABASE_URL", "API_SESSION_SECRET"] as const;
for (const v of requiredEnvVars) {
  if (!process.env[v]) {
    console.error(`FATAL: missing required env var ${v}`);
    process.exit(1);
  }
}

const port = Number(process.env.API_PORT ?? 4101);

const app = await buildApp({ logger: true });
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
