# ADR 0010 — Simpler add-task body, repeat rules, and the glass refresh

- Status: Accepted
- Date: 2026-10-10
- Extends: SPEC §6 (add-task flow), §13 (recurring tasks), §5 (dashboard look); ADR 0008 (team-first rows are unchanged)
- Reference: the owner's prototype `docs/prototype/eom-tasks.html` — `renderAdd`, `scheduleSheet`, `recurPicker`,
  `recurText`, `nextDate`, `micToggle`, and the second `<style>` block ("Glass refresh: refined palette")

## Context

The owner simplified the add-task screen in the prototype: no date / time inputs in the body, quick "How long" pills, a
proper "Repeat this task" picker and a big voice-note mic. The prototype also got a refined glass palette with a dark
mode. The real app still had the dark add-task body, a details sheet with datetime inputs, a Daily / Weekly / Monthly /
Custom "Loop", and no dark theme.

## Decisions

### Add-task body (`src/components/tasks/*`)
- Body, top → bottom: title · rich description (dictation mic in its toolbar) · pills **★ Important**, **⟳ Recurring**
  (shows the rule summary once set; work tasks only) and **📎 Files** · **How long** (½h 1h 2h 3h 4h 6h 8h + − / +
  stepper in 15-minute steps, min 15 min, default 2h) · round **voice-note mic** · a one-line schedule summary
  ("📅 <date> at <time> · 2h · for Priya · change with the calendar icon below" or "📅 Next free slot: Tom 10:00am · …")
  · the ADR 0008 "Goes to …" card · floating **Save** (meetings: **Schedule** + the attendee glyph).
- The body has no date / time inputs. Scheduling: the bottom bar's calendar icon opens **"When should it start?"**
  (date + start time, **Next free slot** / **Set**); upnext / Tom / today work as before. The end is always start +
  allocated time (the optional "Stop" field and the details sheet are gone, as is the priority select — new tasks are
  NORMAL priority; Edit still changes it).
- The "Next free slot" text is the server's `previewSlot` for the effective assignees (debounced); with nobody to ask
  (e.g. a team without a Team Leader) it falls back to the prototype's `nextSlot()` (next full hour, not before 10:00,
  after 18:00 → tomorrow 10:00, company timezone).
- Voice notes still record with `MediaRecorder` (`useMediaRecorder`) and upload after save as `VOICE_NOTE`
  attachments; the dark input bar and the old waveform pills were replaced by the mic button and chips (m:ss, ▶, ✕).

### Repeat rules (`src/server/tasks/repeat-rule.ts`, `recurrence.ts`, migration `20261010150000_task_repeat_rules`)
- `repeat-rule.ts` is pure (no I/O, client-safe): `nextDate(rule, afterDay, doneCount)`, `describeRule`, presets,
  `completeRule`. Days are `yyyy-MM-dd` keys of **Asia/Kolkata calendar days**, mapped to UTC midnights internally so
  the host timezone never matters. Semantics follow the prototype: DAILY every N days; WEEKDAYS skips Sat/Sun; WEEKLY
  on the chosen weekdays with the interval counted in **Monday-based weeks from the anchor** (first occurrence); MONTHLY
  on a date (clamped to short months, 32 = last day) or on the first … fourth / last weekday, interval counted from the
  anchor month; YEARLY on month/day (29 Feb → 28 Feb in other years); ends Never / after N occurrences (the first
  included) / until a date (inclusive). One deliberate difference: a yearly rule with interval > 1 reads "Every 2 years
  on …" (the prototype always said "Every year").
- `RecurrenceRule` gains nullable task-only columns: `repeatFreq` (new enum `RepeatFrequency`), `monthDay`, `nthWeek`,
  `nthWeekday`, `yearMonth`, `yearDay`, `endAfterCount`, `anchorDate`. The existing `RecurrenceFrequency` enum is **not**
  extended because invoice schedules (`src/server/finance/recurrence.ts`) switch over it exhaustively; task rules also
  write a coarse legacy `frequency` / `byWeekday` so older readers still see something sensible.
- **Legacy rows are mapped on read** (`toRepeatRule`): no `repeatFreq` → DAILY stays daily; WEEKLY / CUSTOM → weekly on
  `byWeekday` (or the occurrence's weekday) every `interval` weeks; MONTHLY → monthly on the occurrence's date. With no
  anchor the occurrence being followed is the anchor, which reproduces the old `addDays` / `addWeeks` / `addMonths`
  results (the existing `nextRunAt` tests still pass unchanged).
- `nextRunAt(rule, after, tz, doneCount)` = next repeat day at the **same time of day** in the company timezone.
  `createTask` anchors the rule on the first occurrence's day and stores `nextRunAt` (doneCount 1); `spawnNextOccurrence`
  (used by `jobs/recurrence` for ON_SCHEDULE and by approve-finish for ON_COMPLETE) counts the rule's tasks for "After N
  times". The add-task UI always sends `trigger: ON_SCHEDULE`.
- API: `taskInputSchema.recurrence` is now `{ freq, interval, days, monthMode, monthDay?, nth?, nthDay?, yMonth?, yDay?,
  ends, count, until, anchor?, trigger }`; omitted fields are filled from the first occurrence's day. The old
  `{ frequency, byWeekday, endDate }` input shape is no longer accepted.
- Task rows expose `repeatText` ("Every 2 weeks on Fri · 5 times"), shown in the detail sheet.

### Glass refresh (`src/app/globals.css` + components)
- Tokens from the prototype for light and dark (`prefers-color-scheme`): ink / muted / hairline / glass / chip / input /
  sheet / shadow, top zone teal → sky (`--z1*`, frosted pills, dark-cyan ink), bottom zone emerald (`--z2*`, deeper bar),
  softer row tints and status accents (`--acc-*`), `--primary` / `--primary-ink`. Tailwind colours (`text-ink`,
  `bg-primary`, `bg-glass`, `border-hair`, `text-z2label`, …) point at them via `@theme inline`.
- Existing class names are kept and restyled (`.bg-cyan-area`, `.bg-cyan-pill(-active)`, `.bg-green-area`, `.bg-green-bar`,
  `.bg-green-pill`, `.row-*`, `.glass*`); new helpers: `.bg-green-pill-on`, `.task-card` (floating card with the 4px
  status edge), `.strip-glass`, `.bar-glass`, `.zone-top`, `.glass-card`, `.sheet-panel`, `.toast-glass`, `.mic-btn`,
  `.recsum`, `.field-input` (sky focus ring), `.shadow-glass`.
- Geometry only (no placement changes): task cards 10px side margin / 8px gap / 16px radius, chips wrap, right pills 23px,
  circle 32px, icon buttons 34px muted; cyan zone 22px bottom radius; filter strip 20px top radius; green rows 40px with
  28px pills; bars 56px; page header 56px glass with a 17px bold title; list rows glass cards (12px margin, 14×16
  padding); bottom zones 22px top radius; buttons 46px / 14px radius; segmented 34px; inputs 44px / 12px radius; field
  labels 10.5px uppercase 0.07em; sheets 26px top radius, grab handle, 18px title, 20px side padding; frosted dark toasts.
- Selected states use `--primary` (dark ink in light mode, light ink in dark mode), never a literal `#111`.
- Dark mode for screens not yet converted (finance, vault, attendance…): the Tailwind grey scale is inverted in dark mode
  and a small safety net maps `bg-white/40…85`, `border-white/60|70` and `text-[#111]` to the glass / hairline / ink tokens.
- `.phone-frame` no longer has `backdrop-filter`; MenuTray and Sheet stay portalled to `<body>` so no blurred ancestor
  can capture their `position: fixed` overlays.

## Consequences
- Callers of `createTask` must send the new recurrence shape (the add-task UI and tests do).
- Old recurring tasks keep producing occurrences on the same dates as before; editing a rule is still not offered.
- The app follows the device's light / dark setting; there is no in-app theme toggle yet (`data-theme="light"` on
  `<html>` would force light).

## Addendum (2026-10-10) — the start time is optional: date-only scheduling

Owner's revision (prototype `scheduleSheet`, `dayFreeSlot`, `plannedAssignees`): in "When should it start?" the
**start time is optional**. A date with no time means "the next free time on that day" for the people the task lands on.

- **Form value** (`AddTaskForm.scheduledStart`): `""` = Up next (next free slot from now, unchanged); `"yyyy-MM-dd"` =
  a day with no time (the calendar icon with the time left blank, and now also the **Today / Tomorrow** pills — they no
  longer mean a fixed 10:00 / next full hour); `"yyyy-MM-ddTHH:mm"` = an explicit start (the time typed in, the
  meeting START pills, Find a time). `toTaskInput` sends a date-only value through untouched; `scheduleValue(date, time)`
  builds the sheet's value. The sheet's time field is blank by default (label "Start time (optional)", hint "Leave
  blank: the next free time on that day").
- **Server** (`taskInputSchema` / `taskUpdateSchema.scheduledStart`): ISO instant, a real `yyyy-MM-dd`, or null. A
  date-only start is resolved in `createTask` / `updateTask` before saving — the DB never holds a date-only value and
  `new Date("yyyy-MM-dd")` (UTC midnight) is never used. `proposeSlotOnDay` (`src/server/scheduling/day-slot.ts`) =
  the same busy data and `findSlot` as Up next (`collectBusy`), with `from = max(that day's start, now)` bound to that
  day (`findSlot`'s `until`), **strict only** (a subordinate's self-assigned task is never displaced just to fit the
  requested day). Like the prototype's `dayFreeSlot`, the first gap the WHOLE task fits in wins; only a task longer
  than any lunch-bounded block may be split across that day's free time (as Up next does). It skips the assignees'
  active tasks, Calendar busy blocks, lunch, holidays and approved leave, and the assignees are the ones
  `planAssignment` already resolves (Admin → the teams' Team Leaders; TL → picked executives / the team; Exec → self;
  meetings → organiser + internal attendees). A day with no room falls back **day by day** — the same whole-then-split
  search on each following day (60 days), so the task lands where Up next would put it (a nearer day it fits on split
  beats a later day it fits on whole); a task longer than any single day takes the usual Up-next proposal from that
  day (split across days, then overlap), which may well still START on the requested day. The result carries
  `day: { requestedDay, onRequestedDay, missed, freeMinutes }` — `onRequestedDay` = the start is on that day (whatever
  path found it); `missed` = why not: `day-off` (weekend / holiday / everyone on leave), `over` (today, after hours),
  `full` (every minute taken) or `no-room` (some free time, `freeMinutes`, but less than the task). A day before today
  is refused ("That day has passed — pick today or later"; the sheet refuses it too, `min` on the date). The day key
  is read in the **company** time zone for tasks (working hours live there) and in the **meeting's** zone for meetings
  (`dayZone` — the form picks and shows it there, so Today / Tomorrow / the sheet's date mean the same day on both
  sides; the working hours stay the company's, a meeting-zone day may straddle two company days); all-day meetings
  read it in the meeting zone as before (= that day's midnight). The repeat rule anchors on the day the task actually
  got.
- **UI**: the details tray caption reads "Fri 23 Oct - next free 11:30 am" (date-only, resolved by a debounced
  `previewSlot(ids, minutes, type, day)`), "Fri 23 Oct 2 pm" (explicit), "Up next" (none); a line under the time row
  shows the same while the tray is open (red when the server refused the day: "Fri 9 Oct - That day has passed — pick
  today or later"). When the day did not fit, the caption says "Fri 23 Oct full - next free Sat 24 Oct 10 am" and the
  success toast says "Fri 23 Oct was full - scheduled for Sat 24 Oct 10 am" — a weekend / holiday: "is a day off";
  today after hours: "is over"; too little room: "has / had only 1h free". The minimised tray's caption wraps onto a
  second line rather than truncating, so the resolved time at its end stays visible at 360px. The Edit sheet keeps its
  datetime-local inputs (explicit times only).
