export const JOBS = {
  overdue: () => import("@/jobs/overdue"),
  recurrence: () => import("@/jobs/recurrence"),
  invoices: () => import("@/jobs/invoices"),
  "vault-expiry": () => import("@/jobs/vault-expiry"),
  inventory: () => import("@/jobs/inventory"),
} as const;

export type JobName = keyof typeof JOBS;

export async function runJob(name: JobName): Promise<unknown> {
  const mod = (await JOBS[name]()) as { run: () => Promise<unknown> };
  return mod.run();
}
