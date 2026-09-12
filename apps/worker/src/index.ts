import "dotenv/config";
import { getDb, resetDbInstance } from "@cpd/core";
import { createContainer } from "@cpd/ai";
import { registerHandlers } from "./handlers.js";
import { startScheduler } from "./scheduler.js";
import pino from "pino";

const logger = pino({ level: process.env["LOG_LEVEL"] ?? "info" });

const db = getDb();
const container = createContainer(db);

await container.loadProviderState();
logger.info("Provider state loaded from DB");

registerHandlers(container, logger);
logger.info("Job handlers registered");

const schedulerIntervals = startScheduler(container, logger);
logger.info("Scheduler started");

const shutdown = async () => {
  logger.info("Shutting down worker...");
  container.jobQueue.stop();
  for (const id of schedulerIntervals) clearInterval(id);
  await container.saveProviderState();
  logger.info("Provider state saved");
  await resetDbInstance();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

container.jobQueue.start();
logger.info("Worker started — polling for jobs");
