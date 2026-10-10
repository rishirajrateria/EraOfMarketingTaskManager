import { revalidatePath } from "next/cache";

/**
 * `revalidatePath` throws when called outside a Next.js request scope (vitest, job runner).
 * Server actions call this instead so the same code path is testable and job-safe.
 */
export function safeRevalidate(...paths: string[]): void {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      // Not inside a request (tests / background jobs): nothing to revalidate.
    }
  }
}
