"use client";
import { Check, X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { GroupLabel, SegButton } from "@/components/ui/Controls";
import { MAX_REMINDERS } from "@/server/tasks/schema";
import {
  GOOGLE_EVENT_COLOURS,
  addReminder,
  reminderMinutes,
  splitReminder,
  timeZoneChoices,
  type MeetingOptions,
  type Reminder,
  type ReminderUnit,
} from "@/server/tasks/meeting";

/** iOS-style switch row. */
function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex min-h-11 w-full items-center justify-between gap-3 py-1 text-left">
      <span>
        <span className="block text-[14.5px] text-ink">{label}</span>
        {hint ? <span className="block text-[11.5px] text-muted">{hint}</span> : null}
      </span>
      <span className={clsx("relative h-[26px] w-[44px] shrink-0 rounded-full transition", on ? "bg-[#16a34a]" : "bg-[rgba(120,130,150,.35)]")} aria-hidden>
        <span className={clsx("absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[21px]" : "left-[3px]")} />
      </span>
    </button>
  );
}

const UNITS: ReminderUnit[] = ["minutes", "hours", "days", "weeks"];
const UNIT_LABEL: Record<ReminderUnit, string> = { minutes: "min before", hours: "hours before", days: "days before", weeks: "weeks before" };
const smallSelect = "field-input h-10 rounded-xl border border-hair bg-input px-2 text-[14px] text-ink";

function ReminderRow({ r, onChange, onRemove }: { r: Reminder; onChange: (r: Reminder) => void; onRemove: () => void }) {
  const { value, unit } = splitReminder(r.minutes);
  return (
    <li className="flex items-center gap-1.5">
      <select aria-label="Notify by" className={smallSelect} value={r.method} onChange={(e) => onChange({ ...r, method: e.target.value as Reminder["method"] })}>
        <option value="popup">Notification</option>
        <option value="email">Email</option>
      </select>
      <input
        aria-label="How long before"
        type="number"
        min={0}
        inputMode="numeric"
        className={clsx(smallSelect, "w-[64px] text-center")}
        value={value}
        onChange={(e) => onChange({ ...r, minutes: reminderMinutes(Number(e.target.value), unit) })}
      />
      <select aria-label="Unit" className={clsx(smallSelect, "min-w-0 flex-1")} value={unit} onChange={(e) => onChange({ ...r, minutes: reminderMinutes(value, e.target.value as ReminderUnit) })}>
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABEL[u]}
          </option>
        ))}
      </select>
      <button type="button" onClick={onRemove} aria-label="Remove notification" className="flex h-10 w-8 shrink-0 items-center justify-center text-muted">
        <X size={16} aria-hidden />
      </button>
    </li>
  );
}

/**
 * "Meeting options" (ADR 0012), from the ⚙ Options chip: every field maps onto the Google Calendar event —
 * Meet on / off, all day, notifications (≤ 5), guest permissions, location, busy / free, visibility, colour, time zone.
 */
export function MeetingOptionsSheet({
  open,
  onClose,
  value,
  onChange,
  companyTz,
  onFindTime,
}: {
  open: boolean;
  onClose: () => void;
  value: MeetingOptions;
  onChange: (v: MeetingOptions) => void;
  companyTz: string;
  onFindTime?: () => void;
}) {
  const o = value;
  const set = (p: Partial<MeetingOptions>) => onChange({ ...o, ...p });
  const zone = o.timeZone || companyTz;
  const setReminder = (i: number, r: Reminder) => set({ reminders: o.reminders.map((x, j) => (j === i ? r : x)) });
  return (
    <Sheet open={open} onClose={onClose} title="Meeting options">
      <div className="space-y-4 px-4 pb-5 pt-1">
        <section className="divide-y divide-[var(--hair)]">
          <Toggle label="Add Google Meet" hint={o.withMeet ? "A Meet link is created with the event" : "Plain calendar event, no video link"} on={o.withMeet} onChange={(withMeet) => set({ withMeet })} />
          <Toggle label="All day" hint="No start time; blocks the whole day" on={o.allDay} onChange={(allDay) => set({ allDay })} />
        </section>

        <section>
          <GroupLabel>Notifications</GroupLabel>
          <ul className="space-y-2">
            {o.reminders.map((r, i) => (
              <ReminderRow key={i} r={r} onChange={(nr) => setReminder(i, nr)} onRemove={() => set({ reminders: o.reminders.filter((_, j) => j !== i) })} />
            ))}
          </ul>
          {o.reminders.length < MAX_REMINDERS ? (
            <button type="button" onClick={() => set({ reminders: addReminder(o.reminders) })} className="mt-2 text-[13px] font-semibold text-ink underline underline-offset-2">
              + Add notification
            </button>
          ) : (
            <p className="mt-2 text-[11.5px] text-muted">Google Calendar allows up to {MAX_REMINDERS} notifications.</p>
          )}
          {!o.reminders.length ? <p className="mt-1 text-[11.5px] text-muted">No notifications for this event.</p> : null}
        </section>

        <section>
          <GroupLabel>Guest permissions</GroupLabel>
          <div className="divide-y divide-[var(--hair)]">
            <Toggle label="Modify event" on={o.guestsCanModify} onChange={(guestsCanModify) => set({ guestsCanModify })} />
            <Toggle label="Invite others" on={o.guestsCanInviteOthers} onChange={(guestsCanInviteOthers) => set({ guestsCanInviteOthers })} />
            <Toggle label="See guest list" on={o.guestsCanSeeOtherGuests} onChange={(guestsCanSeeOtherGuests) => set({ guestsCanSeeOtherGuests })} />
          </div>
        </section>

        <Field label="Location">
          <input className={inputCls} value={o.location} maxLength={500} placeholder="Add location" onChange={(e) => set({ location: e.target.value })} />
        </Field>

        <section>
          <GroupLabel>Show as</GroupLabel>
          <div className="flex gap-2">
            <SegButton on={o.transparency === "opaque"} onClick={() => set({ transparency: "opaque" })}>
              Busy
            </SegButton>
            <SegButton on={o.transparency === "transparent"} onClick={() => set({ transparency: "transparent" })}>
              Free
            </SegButton>
          </div>
        </section>

        <section>
          <GroupLabel>Visibility</GroupLabel>
          <div className="flex gap-2">
            {(["default", "public", "private"] as const).map((v) => (
              <SegButton key={v} on={o.visibility === v} onClick={() => set({ visibility: v })}>
                {v === "default" ? "Default" : v === "public" ? "Public" : "Private"}
              </SegButton>
            ))}
          </div>
        </section>

        <section>
          <GroupLabel>Colour</GroupLabel>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Event colour">
            <SegButton on={!o.colorId} onClick={() => set({ colorId: "" })}>
              Calendar colour
            </SegButton>
            {GOOGLE_EVENT_COLOURS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={o.colorId === c.id}
                aria-label={c.name}
                title={c.name}
                onClick={() => set({ colorId: c.id as MeetingOptions["colorId"] })}
                className={clsx("flex h-8 w-8 items-center justify-center rounded-full text-white", o.colorId === c.id && "ring-2 ring-ink ring-offset-2 ring-offset-[var(--sheet)]")}
                style={{ background: c.hex }}
              >
                {o.colorId === c.id ? <Check size={15} strokeWidth={3} aria-hidden /> : null}
              </button>
            ))}
          </div>
        </section>

        <Field label="Time zone" hint="The start time is in this time zone">
          <select className={inputCls} value={zone} onChange={(e) => set({ timeZone: e.target.value === companyTz ? "" : e.target.value })}>
            {timeZoneChoices(zone, companyTz).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
                {z === companyTz ? " (company)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex gap-2.5">
          {onFindTime ? (
            <button type="button" className={clsx(btnSecondary, "flex-1")} onClick={onFindTime}>
              Find a time
            </button>
          ) : null}
          <button type="button" onClick={onClose} className={clsx(btnPrimary, "flex-1")}>
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
}
