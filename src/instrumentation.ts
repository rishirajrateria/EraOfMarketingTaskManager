export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && (process.env.JOBS_INLINE ?? "true") !== "false") {
    const { startInlineJobs } = await import("@/jobs/runner");
    startInlineJobs();
  }
}
