import { formatInTimeZone } from "date-fns-tz";
import { dateKey } from "@/lib/time";

/** "Approved · Today 2:30 pm" / "Approved · Fri 13 Nov 10 am" / "Approved · due 13 Nov" (+ "· next free slot"). */
export function approvedToast(res: { start: string; onRequested: boolean }, deadline: boolean, tz: string, now = new Date()): string {
  const start = new Date(res.start);
  const day = dateKey(start, tz) === dateKey(now, tz) ? "Today" : formatInTimeZone(start, tz, "EEE d MMM");
  const min = formatInTimeZone(start, tz, "mm");
  const time = formatInTimeZone(start, tz, min === "00" ? "h a" : "h:mm a").toLowerCase();
  const when = deadline ? `due ${formatInTimeZone(start, tz, "d MMM")}` : `${day} ${time}`;
  return `Approved · ${when}${res.onRequested ? "" : " · next free slot"}`;
}
