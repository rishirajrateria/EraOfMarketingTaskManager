/**
 * Pause / resume database writes, shared by the single-task actions (`pauseTask` / `resumeTask`) and Admin's
 * "Pause all" (`pauseResumeMany`, ADR 0015). Returns Prisma operations for one `$transaction([...])`.
 */
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nextStatus } from "@/server/tasks/state";

type PauseTask = { id: string; status: TaskStatus };
type ResumeTask = { id: string; status: TaskStatus; statusBeforePause: TaskStatus | null; pausedAt: Date | null; scheduledEnd: Date | null };

/** Closes the open session and freezes the task (PAUSED, remembering the status it had). */
export function pauseOps(t: PauseTask, now: Date): { status: TaskStatus; ops: Prisma.PrismaPromise<unknown>[] } {
  const status = nextStatus(t.status, "PAUSE");
  return {
    status,
    ops: [
      prisma.taskSession.updateMany({ where: { taskId: t.id, endedAt: null }, data: { endedAt: now } }),
      prisma.task.update({ where: { id: t.id }, data: { status, statusBeforePause: t.status, pausedAt: now } }),
    ],
  };
}

/** Back to the status before the pause; the scheduled end shifts by the paused minutes; a running task gets a new session. */
export function resumeOps(t: ResumeTask, now: Date): { status: TaskStatus; pausedMin: number; ops: Prisma.PrismaPromise<unknown>[] } {
  const status = nextStatus(t.status, "RESUME", t.statusBeforePause);
  const pausedMin = t.pausedAt ? Math.round((now.getTime() - t.pausedAt.getTime()) / 60000) : 0;
  const wasRunning = t.statusBeforePause === "STARTED" || t.statusBeforePause === "FINISH_REQUESTED";
  return {
    status,
    pausedMin,
    ops: [
      prisma.task.update({
        where: { id: t.id },
        data: {
          status,
          statusBeforePause: null,
          pausedAt: null,
          pausedTotalMinutes: { increment: pausedMin },
          scheduledEnd: t.scheduledEnd ? new Date(t.scheduledEnd.getTime() + pausedMin * 60000) : null,
        },
      }),
      ...(wasRunning ? [prisma.taskSession.create({ data: { taskId: t.id, startedAt: now } })] : []),
    ],
  };
}
