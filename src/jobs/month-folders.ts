import { ensureMonthFolder, monthKeyOf } from "@/server/finance/month-folders";

/**
 * Monthly Drive folders (ADR 0009): makes sure Finance/<this month> and its four subfolders exist (runs daily, so the
 * folder appears on the 1st). Idempotent — the ids are cached in FinanceMonthFolder. Drive failures are reported, not thrown.
 */
export type MonthFoldersJobResult = { month: string; folderId: string | null; error?: string };

export async function run(now = new Date()): Promise<MonthFoldersJobResult> {
  const month = await monthKeyOf(now);
  try {
    const f = await ensureMonthFolder(month);
    return { month, folderId: f.folderId };
  } catch (e) {
    return { month, folderId: null, error: e instanceof Error ? e.message : String(e) };
  }
}
