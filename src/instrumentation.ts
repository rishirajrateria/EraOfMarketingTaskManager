export async function register() {
  // The runtime check must wrap the dynamic imports (not an early return) so Next drops them from the Edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast (once, at boot) on an unsafe production configuration, see ADR 0020.
    const { assertProductionEnv } = await import("@/lib/prod-guards");
    try {
      assertProductionEnv(process.env);
    } catch (e) {
      // Next would only log an unhandled rejection and sit there never becoming ready; exit so the host sees a failed deploy.
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
    if ((process.env.JOBS_INLINE ?? "true") !== "false") {
      const { startInlineJobs } = await import("@/jobs/runner");
      startInlineJobs();
    }
  }
}
