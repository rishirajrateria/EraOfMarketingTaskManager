/**
 * The bottom nav's + lives in the app shell, the add-task sheet in the task dashboard. While the dashboard is mounted
 * it registers its opener here so Task / Meeting open the sheet in place; elsewhere `open` returns false and the nav
 * goes to `/dashboard?add=…` instead (ADR 0016 addendum).
 */
export type AddTaskMode = "WORK" | "MEETING";
type Opener = (mode: AddTaskMode) => void;

let opener: Opener | null = null;

export const addTaskStore = {
  /** Returns the unregister function (only clears the opener if it is still this one). */
  register(fn: Opener): () => void {
    opener = fn;
    return () => {
      if (opener === fn) opener = null;
    };
  },
  open(mode: AddTaskMode): boolean {
    if (!opener) return false;
    opener(mode);
    return true;
  },
};
