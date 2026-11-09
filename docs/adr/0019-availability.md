# ADR 0019 — One source of truth for availability

- Status: Accepted
- Date: 2026-11-09
- Builds on: ADR 0010 (date-only starts), ADR 0015 / 0016 (meetings are tasks, not booked hours), SPEC §9.2–§9.3, §11.5

## Context

"Is this person available at this time?" was answered in five places with five different rules:

- the slot finder (`scheduling/slot.ts`, `day-slot.ts`) looked only at company hours, company holidays and approved
  leave — it ignored attendance rows (ABSENT / HALF_DAY / …), the person's own working days and their
  `dailyCapacityMinutes`, so "Up next" booked absent people and put a 6h task on a half day;
- inventory (`inventory/compute.ts`) put holiday / leave first, then weekly off, then the row;
- the attendance grid put the row first, then leave, then holiday;
- the HR tile put the row first and showed "Not marked" on holidays and weekly offs;
- the Day view used the company's working days only.

Inventory also counted a multi-day task entirely on its start day, and holiday / leave keys were converted with two
different date functions (`dateKey(h, tz)` vs `fromDbDate`), which disagree west of UTC.

## Decision

### The single function

`personDayStatus({ user, dayKey, cfg, onLeave, attendance })` in `src/server/availability/day-status.ts` returns

```ts
{ kind: "WORKING" | "HALF" | "OFF_WEEKLY" | "HOLIDAY" | "LEAVE" | "ABSENT",
  window: Interval[],        // when the person can work that day (UTC instants, lunch excluded)
  capacityMinutes: number,   // what the day counts for in inventory = the most the slot finder books that day
  marked: AttendanceStatus | null,
  presentOnOffDay: boolean } // PRESENT / HALF_DAY row on a leave, holiday or weekly-off day
```

`loadAvailability` (`availability/load.ts`) loads leave + attendance for a set of people and a range of day keys and
answers `availability.day(userId, dayKey)` through that function. Every consumer goes through it:

| Consumer | Uses |
| --- | --- |
| Slot finder ("Up next", date-only starts, leave shift) | `window` (intersected across assignees) and `capacityMinutes − booked` per day (`scheduling/finder.ts`) |
| Inventory page, add-task header, HR tile capacity, nightly snapshot | `capacityMinutes`, `kind` (`inventoryFor`) |
| Day view (hourly) | `kind` for the row label, `window` for half-day hours |
| Attendance grid | `kind`, `marked`, `presentOnOffDay` (`gridCell`) |
| HR tile "today" | `kind`, `marked`, `presentOnOffDay` (`todayStatus`) |
| "<Name> is off that day" warning | `kind` (`availability/warnings.ts`) |

`computeCapacityMinutes` remains as a thin wrapper for callers holding booleans.

### Precedence

**approved leave > company holiday > weekly off > attendance row (ABSENT / HALF_DAY / LEAVE / HOLIDAY) > working.**

- Weekly off = not a company working day, or not one of the person's own `workingDays`.
- A PRESENT (or HALF_DAY) row on a leave / holiday / weekly-off day does not make the person available. The grid shows
  the day as Leave / Holiday with a red ring and "Marked present on …"; the HR tile shows the off status with a "!".
- The HR tile shows "Holiday" and "Off" for company holidays and weekly offs; "Not marked" only on a working day
  without a row.

### Capacity and windows

- WORKING: window = company working hours minus lunch; capacity = `dailyCapacityMinutes` or the productive day.
- HALF: capacity = `halfDayMinutes` (Settings), capped at the full capacity. The window is the row's check-in/out when
  set, else the first half of the working day — never longer than the capacity (e.g. 10:00–13:30 + 14:30–15:00).
- Everything else: no window, 0 capacity.

### Booked work and multi-day tasks

`availability/booked.ts` is the one definition of booked work: open WORK tasks with time (deadline-only tasks and
meetings book no hours). A task's minutes are spread over the days of its `[scheduledStart, scheduledEnd)` in
proportion to the person's window inside that span, each day capped at its capacity — the same model the slot finder
fills. A single-day task, or one that sits entirely on off time, books its start day; unscheduled tasks book today.

### Overbooking is exposed

`sellable()` still clamps at 0, but every inventory row and total now carries `overbookedMinutes`
(`max(0, assigned − capacity)`, summed per day so a free Tuesday does not hide an overbooked Monday). The inventory
table, the Day view and the strip show it as a red "over by Xh"; the HR tile lists "over by".

### Slot finder

Free time on a day = the intersection of every assignee's `window` minus busy blocks (tasks, meetings, calendar),
and at most the smallest `capacityMinutes − booked` among them. Without split, the whole task must fit in one gap
and within that day's capacity left. In the loose pass (overlapping subordinates' soft blocks) the displaced tasks'
booked minutes are given back.

### Meetings (ADR 0015 / 0016 kept)

Meetings count as tasks, not booked hours: they never add to `assignedMinutes`. They are busy time: the slot finder
cannot place work over them and the Day view shows their hours as assigned.

### Leave shift

- `tasksAffectedByLeave` returns every open task in the leave with `movable` and `why` (`started`, `meeting`,
  `protected`). Started tasks, meetings and protected tasks are never moved automatically; the inbox lists them as
  "Move yourself".
- A moved task searches from `max(now, leave start, its original start)`, so it lands after the leave and never
  earlier than it was; only when nothing is found from there does it fall back to "from now".
- `tasksShiftedAt` is set only when nothing is left in the leave; until then the leave stays under "needs shift" with
  the remaining tasks.

### Day keys

All `@db.Date` values (holidays, leave from / to, attendance dates) are read with `fromDbDate`; `workingConfig()`
and `leaveDayKeys` no longer use `dateKey(value, tz)`. Leave windows are `[parseDateKey(from, tz), parseDateKey(to + 1, tz))`.

### Manual starts on a day off

The add-task and edit forms show "<Name> is off that day" (non-blocking) when a manually picked start falls on a day
the assignee is on leave, on a holiday, on a weekly off or absent. Saving is still allowed (Admin may book it
deliberately); the booking then shows as overbooked on that day.

### Removed

`periodLoads` / `periodLoad` (only tests used them) are gone; the add-task header is `addTaskInventory`, which reads
`inventoryFor`.

## Consequences

- One change to availability rules is one change in `day-status.ts`.
- `collectBusy` now returns `{ hard, soft, world }` instead of `{ hard, soft, off }`.
- Test fixtures that booked "busy" blocks spanning lunch now book the working minutes they cover; otherwise the
  capacity check correctly treats the day as full.
- Recurring occurrences (`tasks/recurring.ts`) still land at their due time via company hours only; routing them
  through the slot finder is a separate change.
