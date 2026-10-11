/**
 * Review per pill (ADR 0015): a Team Leader / Executive long-presses the date, hours or start-time pill to ask Admin to
 * review it; a red dot sits on that pill until Admin marks it reviewed (or edits the task), or the requester withdraws.
 * Pure and client-safe.
 */
export const REVIEW_FIELDS = ["date", "time", "mins"] as const;
export type ReviewField = (typeof REVIEW_FIELDS)[number];

export const REVIEW_FIELD_NAME: Record<ReviewField, string> = { date: "start date", time: "start time", mins: "time allotted" };

export const isReviewField = (v: unknown): v is ReviewField => typeof v === "string" && (REVIEW_FIELDS as readonly string[]).includes(v);

/** Flagged fields of a task; the old single flag (no fields recorded) counts as "time allotted". */
export function reviewFieldsOf(t: { reviewFields?: string[] | null; reviewRequested?: boolean }): ReviewField[] {
  const list = (t.reviewFields ?? []).filter(isReviewField);
  return list.length ? list : t.reviewRequested ? ["mins"] : [];
}

/** Adds / removes a field, keeping the canonical order date · time · mins. */
export function withField(fields: string[], field: ReviewField, on: boolean): ReviewField[] {
  const set = new Set(fields.filter(isReviewField));
  if (on) set.add(field);
  else set.delete(field);
  return REVIEW_FIELDS.filter((f) => set.has(f));
}

/** Old long-press requests map onto pills: a review → time allotted, a time change → start time. */
export const fieldForKind = (kind: "REVIEW" | "TIME_CHANGE"): ReviewField => (kind === "TIME_CHANGE" ? "time" : "mins");
