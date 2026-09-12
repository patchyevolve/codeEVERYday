import type { Container } from "@cpd/ai";
import type { Logger } from "pino";

export function registerHandlers(c: Container, log: Logger) {
  c.jobQueue.on("CONTENT_GENERATION", async (payload: Record<string, unknown>) => {
    const contentId = payload["contentId"] as string;
    log.info({ contentId }, "CONTENT_GENERATION handler invoked (stub — content pipeline not yet wired)");
  });

  c.jobQueue.on("CONTENT_REVIEW", async (payload: Record<string, unknown>) => {
    const contentId = payload["contentId"] as string;
    log.info({ contentId }, "CONTENT_REVIEW handler invoked (stub — content pipeline not yet wired)");
  });

  c.jobQueue.on("CONTENT_REPAIR", async (payload: Record<string, unknown>) => {
    const contentId = payload["contentId"] as string;
    log.info({ contentId }, "CONTENT_REPAIR handler invoked (stub — content pipeline not yet wired)");
  });

  c.jobQueue.on("SESSION_REVIEW", async (payload: Record<string, unknown>) => {
    const sessionId = payload["sessionId"] as string;
    log.info({ sessionId }, "Processing SESSION_REVIEW");
    const report = await c.sessionController.generateReport(sessionId);
    log.info({ sessionId, objective: report.objective }, "Session report generated");
  });
}
