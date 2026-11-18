/**
 * The morning "Is <Name> back today?" (ADR 0022): for every "Ask tomorrow" early leave whose covered days are over,
 * each company working morning asks Admins and HR (a card at the top of Requests / Attendance + BACK_QUESTION).
 * Runs every 30 minutes; asks once per day per person (idempotent).
 */
import { askWhoIsBack } from "@/server/early-leave/service";

export async function run(now = new Date()): Promise<{ asked: number }> {
  return askWhoIsBack(now);
}
