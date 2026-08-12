import { nextSchedule } from "@sad/core";
import type { FastifyBaseLogger } from "fastify";
import type { AppDatabase } from "./database.js";

export function startScheduler(db: AppDatabase, log: FastifyBaseLogger): () => void {
  const tick = () => {
    for (const project of db.listDueProjects()) {
      try {
        db.enqueueRun(project.id, "scheduled");
        db.setNextRun(
          project.id,
          nextSchedule(project.schedule_expression, project.schedule_timezone).toISOString(),
        );
      } catch (error) {
        log.error(
          { projectId: project.id, error: error instanceof Error ? error.message : "unknown" },
          "schedule tick failed",
        );
      }
    }
  };
  tick();
  const timer = setInterval(tick, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
