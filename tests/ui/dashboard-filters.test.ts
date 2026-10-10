import { describe, expect, it } from "vitest";
import { applyFilters, dayKeys, normaliseFilters, toggleIn, type FilterCtx } from "@/components/dashboard/filters";
import { datePill, fmtClock, fmtShortDate, pillHours, sanitizeHtml, taskPeople, teamChipLabel, teamCode, waveformHeights } from "@/components/dashboard/format";
import { dockFilters, dayLabel, hoursText, summaryCaption, summaryGroups } from "@/components/dashboard/summary";
import { DEFAULT_FILTERS, type DashboardData, type DashboardFilters, type TaskRow } from "@/server/tasks/types";

const TZ = "Asia/Kolkata";
// 2026-09-10 11:30 IST
const NOW = new Date("2026-09-10T06:00:00Z");
const ME = "u-me";

let seq = 0;
function task(p: Partial<TaskRow> = {}): TaskRow {
  seq++;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    description: "",
    type: "WORK",
    status: "ASSIGNED",
    colour: "white",
    overdue: false,
    important: false,
    priority: "NORMAL",
    doubtRaised: false,
    doubtNote: null,
    reviewRequested: false,
    reviewNote: null,
    reviewFields: [],
    paused: false,
    recurring: false,
    selfAssigned: false,
    protected: false,
    client: { id: "c1", name: "Repo" },
    teams: [{ id: "team1", name: "Graphic", colour: "#000" }],
    assignees: [{ id: "u1", name: "Arush Kumar", avatar: null }],
    preferredAssigneeIds: [],
    tags: [],
    workTypeId: null,
    allocatedMinutes: 60,
    scheduledStart: "2026-09-10T04:30:00Z", // today 10:00 IST
    scheduledEnd: "2026-09-10T05:30:00Z",
    actualStart: null,
    actualEnd: null,
    driveFolderUrl: null,
    meetLink: null,
    meetActive: false,
    meetingNotesUrl: null,
    meetingNotes: [],
    guestEmails: [],
    meetingOptions: null,
    chatSpaceUrl: null,
    calendarEventId: null,
    integrationError: null,
    finishRequestedAt: null,
    parentTaskId: null,
    childTaskId: null,
    attachments: [],
    createdById: "u1",
    createdAt: "2026-09-01T00:00:00Z",
    ...p,
  };
}

const ctx = (role: FilterCtx["role"] = "ADMIN", extra: Partial<FilterCtx> = {}): FilterCtx => ({ role, meId: ME, tz: TZ, now: NOW, ...extra });
const f = (p: Partial<DashboardFilters> = {}): DashboardFilters => ({ ...DEFAULT_FILTERS, ...p });
const ids = (rows: TaskRow[]) => rows.map((t) => t.id);

describe("dayKeys", () => {
  it("computes today / tomorrow in the company timezone", () => {
    expect(dayKeys(NOW, TZ)).toEqual({ today: "2026-09-10", tomorrow: "2026-09-11", day2: "2026-09-12" });
    // 20:30 UTC is already the next day in IST
    expect(dayKeys(new Date("2026-09-10T20:30:00Z"), TZ).today).toBe("2026-09-11");
  });
});

describe("applyFilters — completed toggle", () => {
  it("hides COMPLETED rows unless the toggle is on", () => {
    const open = task();
    const done = task({ status: "COMPLETED", colour: "grey" });
    expect(ids(applyFilters([open, done], f(), ctx()))).toEqual([open.id]);
    expect(ids(applyFilters([open, done], f({ completed: true }), ctx()))).toEqual([open.id, done.id]);
  });
});

describe("applyFilters — colour and icon strip", () => {
  const white = task({ colour: "white" });
  const green = task({ colour: "green", status: "STARTED" });
  const red = task({ colour: "red", overdue: true });
  const all = [white, green, red];

  it("colour filter is OR within the group", () => {
    expect(ids(applyFilters(all, f({ colours: ["green"] }), ctx()))).toEqual([green.id]);
    expect(ids(applyFilters(all, f({ colours: ["green", "red"] }), ctx()))).toEqual([green.id, red.id]);
    expect(ids(applyFilters(all, f({ colours: [] }), ctx()))).toEqual(ids(all));
  });

  it("icon filter matches paused / doubt / review / important / recurring", () => {
    const paused = task({ paused: true, status: "PAUSED" });
    const doubt = task({ doubtRaised: true, colour: "yellow" });
    const review = task({ reviewRequested: true });
    const star = task({ important: true });
    const loop = task({ recurring: true });
    const rows = [white, paused, doubt, review, star, loop];
    expect(ids(applyFilters(rows, f({ icons: ["paused"] }), ctx()))).toEqual([paused.id]);
    expect(ids(applyFilters(rows, f({ icons: ["doubt"] }), ctx()))).toEqual([doubt.id]);
    expect(ids(applyFilters(rows, f({ icons: ["review"] }), ctx()))).toEqual([review.id]);
    expect(ids(applyFilters(rows, f({ icons: ["important"] }), ctx()))).toEqual([star.id]);
    expect(ids(applyFilters(rows, f({ icons: ["recurring"] }), ctx()))).toEqual([loop.id]);
    expect(ids(applyFilters(rows, f({ icons: ["important", "recurring"] }), ctx()))).toEqual([star.id, loop.id]);
  });

  it("restarted icon matches restart copies and completed originals with a child", () => {
    const copy = task({ parentTaskId: "orig" });
    const original = task({ status: "COMPLETED", colour: "grey", childTaskId: copy.id });
    const doneNoChild = task({ status: "COMPLETED", colour: "grey" });
    const rows = [white, copy, original, doneNoChild];
    expect(ids(applyFilters(rows, f({ icons: ["restarted"] }), ctx()))).toEqual([copy.id]);
    expect(ids(applyFilters(rows, f({ icons: ["restarted"], completed: true }), ctx()))).toEqual([copy.id, original.id]);
    expect(normaliseFilters({ icons: ["restarted", "bogus"] }).icons).toEqual(["restarted"]);
  });

  it("colour and icon groups combine with AND", () => {
    const greenStar = task({ colour: "green", status: "STARTED", important: true });
    const rows = [white, green, greenStar, task({ important: true })];
    expect(ids(applyFilters(rows, f({ colours: ["green"], icons: ["important"] }), ctx()))).toEqual([greenStar.id]);
  });
});

describe("applyFilters — bottom rows (role dependent) and AND combination", () => {
  const gr = task({ teams: [{ id: "team1", name: "Graphic", colour: "" }], client: { id: "c1", name: "Repo" } });
  const fin = task({ teams: [{ id: "team2", name: "Finance", colour: "" }], client: { id: "c1", name: "Repo" } });
  const grOther = task({ teams: [{ id: "team1", name: "Graphic", colour: "" }], client: { id: "c2", name: "Other" } });
  const rows = [gr, fin, grOther];

  it("Admin: row1 = team, row2 = client, combined with AND", () => {
    expect(ids(applyFilters(rows, f({ row1: "team1" }), ctx("ADMIN")))).toEqual([gr.id, grOther.id]);
    expect(ids(applyFilters(rows, f({ row2: "c1" }), ctx("ADMIN")))).toEqual([gr.id, fin.id]);
    expect(ids(applyFilters(rows, f({ row1: "team1", row2: "c1" }), ctx("ADMIN")))).toEqual([gr.id]);
    expect(ids(applyFilters(rows, f({ row1: "team2", row2: "c2" }), ctx("ADMIN")))).toEqual([]);
  });

  it("Team Leader: row1 = executive (assignee), row2 = client", () => {
    const a = task({ assignees: [{ id: "e1", name: "Arush", avatar: null }] });
    const b = task({ assignees: [{ id: "e2", name: "Neha", avatar: null }], client: { id: "c2", name: "Other" } });
    expect(ids(applyFilters([a, b], f({ row1: "e2" }), ctx("TEAM_LEADER")))).toEqual([b.id]);
    expect(ids(applyFilters([a, b], f({ row1: "e2", row2: "c1" }), ctx("TEAM_LEADER")))).toEqual([]);
  });

  it("Executive: row1 = client, row2 = work type tag", () => {
    const tagged = task({ tags: [{ id: "w1", name: "Pharma bag", colour: "" }] });
    const plain = task();
    expect(ids(applyFilters([tagged, plain], f({ row2: "w1" }), ctx("EXECUTIVE")))).toEqual([tagged.id]);
    expect(ids(applyFilters([tagged, plain], f({ row1: "c1" }), ctx("EXECUTIVE")))).toEqual([tagged.id, plain.id]);
  });
});

describe("applyFilters — blue-area pills", () => {
  const today = task();
  const tomorrow = task({ scheduledStart: "2026-09-11T04:30:00Z", scheduledEnd: "2026-09-11T05:30:00Z" });
  const later = task({ scheduledStart: "2026-09-20T04:30:00Z", scheduledEnd: "2026-09-20T05:30:00Z" });
  const unscheduled = task({ scheduledStart: null, scheduledEnd: null });
  const rows = [today, tomorrow, later, unscheduled];

  it("team: / person: / client: pills", () => {
    const other = task({ teams: [{ id: "team9", name: "Video", colour: "" }], assignees: [{ id: "u9", name: "Zed", avatar: null }], client: { id: "c9", name: "Nine" } });
    expect(ids(applyFilters([today, other], f({ pill: "team:team9" }), ctx()))).toEqual([other.id]);
    expect(ids(applyFilters([today, other], f({ pill: "person:u1" }), ctx()))).toEqual([today.id]);
    expect(ids(applyFilters([today, other], f({ pill: "client:c9" }), ctx()))).toEqual([other.id]);
  });

  it("date:today / date:tomorrow / date:all", () => {
    expect(ids(applyFilters(rows, f({ pill: "date:today" }), ctx()))).toEqual([today.id]);
    expect(ids(applyFilters(rows, f({ pill: "date:tomorrow" }), ctx()))).toEqual([tomorrow.id]);
    expect(ids(applyFilters(rows, f({ pill: "date:all" }), ctx()))).toEqual(ids(rows));
  });

  it("date:b4leave uses the next leave date when known, otherwise matches everything", () => {
    expect(ids(applyFilters(rows, f({ pill: "date:b4leave" }), ctx("EXECUTIVE")))).toEqual(ids(rows));
    expect(ids(applyFilters(rows, f({ pill: "date:b4leave" }), ctx("EXECUTIVE", { nextLeaveKey: "2026-09-15" })))).toEqual([today.id, tomorrow.id]);
  });

  it("unknown pill formats are ignored", () => {
    expect(ids(applyFilters(rows, f({ pill: "bogus" }), ctx()))).toEqual(ids(rows));
    expect(ids(applyFilters(rows, f({ pill: "date:whatever" }), ctx()))).toEqual(ids(rows));
  });

  it("explicit date filter and quick today/tomorrow", () => {
    expect(ids(applyFilters(rows, f({ date: "2026-09-20" }), ctx()))).toEqual([later.id]);
    expect(ids(applyFilters(rows, f({ quick: "today" }), ctx()))).toEqual([today.id]);
    expect(ids(applyFilters(rows, f({ quick: "tomorrow" }), ctx()))).toEqual([tomorrow.id]);
    expect(ids(applyFilters(rows, f({ quick: "tomorrow", pill: "date:today" }), ctx()))).toEqual([]);
  });

  it("quick asc sorts by scheduled start with unscheduled rows last (stable)", () => {
    const shuffled = [later, unscheduled, tomorrow, today];
    expect(ids(applyFilters(shuffled, f({ quick: "asc" }), ctx()))).toEqual([today.id, tomorrow.id, later.id, unscheduled.id]);
    // without asc the server order is preserved
    expect(ids(applyFilters(shuffled, f(), ctx()))).toEqual(ids(shuffled));
  });
});

describe("applyFilters — recurring / paused toggles", () => {
  it("recurringOnly and pausedOnly narrow the list and combine with AND", () => {
    const loop = task({ recurring: true });
    const paused = task({ paused: true, status: "PAUSED", colour: "green" });
    const both = task({ recurring: true, paused: true, status: "PAUSED", colour: "green" });
    const rows = [task(), loop, paused, both];
    expect(ids(applyFilters(rows, f({ recurringOnly: true }), ctx()))).toEqual([loop.id, both.id]);
    expect(ids(applyFilters(rows, f({ pausedOnly: true }), ctx()))).toEqual([paused.id, both.id]);
    expect(ids(applyFilters(rows, f({ recurringOnly: true, pausedOnly: true }), ctx()))).toEqual([both.id]);
  });
});

describe("helpers", () => {
  it("toggleIn adds and removes", () => {
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });

  it("normaliseFilters coerces persisted JSON and drops junk", () => {
    expect(normaliseFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(normaliseFilters("nope")).toEqual(DEFAULT_FILTERS);
    const n = normaliseFilters({ colours: ["green", "pink"], icons: ["important", 3], row1: "", row2: "c1", pill: "team:x", date: "2026-13-99x", quick: "asc", completed: "yes", pausedOnly: true });
    // "important" (no stars any more) and pausedOnly (now the yellow swatch) are dropped from saved prefs (ADR 0015)
    expect(n).toEqual({ ...DEFAULT_FILTERS, colours: ["green"], icons: [], row2: "c1", pill: "team:x", quick: "asc", pausedOnly: false });
    expect(normaliseFilters({ icons: ["paused", "doubt", "review"] }).icons).toEqual(["doubt", "review"]);
    expect(normaliseFilters({ date: "2026-09-10", quick: "sideways" })).toMatchObject({ date: "2026-09-10", quick: null });
  });

  it("team chip, date pill and the people of the (i) sheet (ADR 0015)", () => {
    expect(teamChipLabel([])).toBeNull();
    expect(teamChipLabel([{ id: "t", name: "Social", colour: "" }])).toBe("Social");
    expect(teamChipLabel([{ id: "t", name: "Social", colour: "" }, { id: "u", name: "SEO", colour: "" }])).toBe("Social +1");
    expect(teamCode("web site")).toBe("WE");
    // always the start DATE — never Today / Tom / Yest
    expect(datePill("2026-10-08T05:30:00Z", "Asia/Kolkata")).toBe("08 Oct");
    expect(datePill(new Date(), "Asia/Kolkata")).toMatch(/^\d{2} [A-Z][a-z]{2}$/);
    expect(datePill(null, "Asia/Kolkata")).toBe("Unsched");
    const people = [
      { id: "tl", name: "Karan Mehta", role: "TEAM_LEADER", teamId: "t" },
      { id: "e1", name: "Sana Shah", role: "EXECUTIVE", teamId: "t" },
      { id: "e2", name: "Arjun Rao", role: "EXECUTIVE", teamId: "t" },
      { id: "tl2", name: "Other Lead", role: "TEAM_LEADER", teamId: "x" },
    ];
    expect(
      taskPeople({ teams: [{ id: "t", name: "Social", colour: "" }], assignees: [{ id: "e1", name: "Sana Shah", avatar: null }], preferredAssigneeIds: ["e2", "gone"] }, people),
    ).toEqual({ teams: ["Social"], leaders: ["Karan Mehta"], assigned: ["Sana Shah"], preferred: ["Arjun Rao"] });
  });

  it("summary hours: one decimal max", () => {
    expect(pillHours(300)).toBe("5");
    expect(pillHours(330)).toBe("5.5");
    expect(pillHours(990)).toBe("16.5");
    expect(pillHours(0)).toBe("0");
    expect(hoursText(708)).toBe("11.8h");
    expect(hoursText(30)).toBe("30m");
    expect(hoursText(0)).toBe("0h");
  });

  it("fmtClock / fmtShortDate use 24h and d/M/yy in the company timezone", () => {
    expect(fmtClock("2026-09-10T11:15:00Z", TZ)).toBe("16:45");
    expect(fmtClock("2026-09-09T23:15:00Z", TZ)).toBe("4:45");
    expect(fmtClock(null, TZ)).toBe("--:--");
    expect(fmtShortDate("2026-09-10T11:15:00Z", TZ)).toBe("10/9/26");
  });

  it("sanitizeHtml strips scripts, handlers and javascript: URLs", () => {
    const dirty = `<p onclick="x()">Hi <a href="javascript:alert(1)">link</a></p><script>evil()</script><b>ok</b>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).toContain("<b>ok</b>");
  });

  it("waveformHeights is deterministic and bounded", () => {
    const a = waveformHeights("att-1");
    expect(a).toEqual(waveformHeights("att-1"));
    expect(a).not.toEqual(waveformHeights("att-2"));
    expect(a).toHaveLength(24);
    expect(a.every((h) => h >= 4 && h <= 22)).toBe(true);
  });
});

describe("top summary — OPEN HOURS (ADR 0015)", () => {
  const teams = [
    { id: "team1", name: "Graphic", colour: "" },
    { id: "team2", name: "Social", colour: "" },
    { id: "team3", name: "SEO", colour: "" },
  ];
  const clients = [
    { id: "c1", name: "Repo" },
    { id: "c2", name: "Zenith Foods" },
  ];
  const people = [
    { id: "tl1", name: "Rishi Kumar", role: "TEAM_LEADER", teamId: "team1", teamLeaderId: null, specialityIds: [] },
    { id: "u1", name: "Arush Kumar", role: "EXECUTIVE", teamId: "team1", teamLeaderId: "tl1", specialityIds: [] },
    { id: "u2", name: "Dev Shah", role: "EXECUTIVE", teamId: "team1", teamLeaderId: "tl1", specialityIds: [] },
    { id: "u3", name: "Isha Rao", role: "EXECUTIVE", teamId: "team2", teamLeaderId: null, specialityIds: [] },
  ];
  const tasks = [
    task({ allocatedMinutes: 240, teams: [teams[0]!], client: clients[0]!, assignees: [{ id: "u1", name: "Arush Kumar", avatar: null }] }), // today
    task({ allocatedMinutes: 120, teams: [teams[0]!], client: clients[1]!, assignees: [{ id: "tl1", name: "Rishi Kumar", avatar: null }], scheduledStart: "2026-09-11T05:00:00Z" }), // tomorrow
    task({ allocatedMinutes: 60, teams: [teams[1]!], client: clients[1]!, assignees: [{ id: "u3", name: "Isha Rao", avatar: null }], scheduledStart: "2026-09-12T05:00:00Z" }), // day+2
    task({ allocatedMinutes: 600, teams: [teams[1]!], client: clients[0]!, status: "COMPLETED", colour: "grey" }), // completed: never counted
    task({ allocatedMinutes: 30, type: "MEETING", teams: [teams[1]!], client: clients[0]! }), // meetings: not work hours
  ];
  const data = (role: DashboardData["role"], extra: Partial<DashboardData> = {}) =>
    ({
      role,
      tasks,
      teams,
      clients,
      people,
      row1: role === "ADMIN" ? teams.map((t) => ({ id: t.id, label: t.name })) : role === "TEAM_LEADER" ? [{ id: "u1", label: "Arush" }, { id: "u2", label: "Dev" }] : clients.map((c) => ({ id: c.id, label: c.name })),
      row2: clients.map((c) => ({ id: c.id, label: c.name })),
      me: { id: role === "TEAM_LEADER" ? "tl1" : role === "EXECUTIVE" ? "u1" : "admin", role, teamId: role === "ADMIN" ? null : "team1" },
      tz: TZ,
      nextLeaveKey: null,
      ...extra,
    }) as unknown as DashboardData;
  const rows = (g: { items: { label: string; minutes: number }[] }) => g.items.map((i) => `${i.label} ${i.minutes / 60}`);

  it("Admin: Teams + Clients only, zero rows hidden, completed and meetings not counted", () => {
    const g = summaryGroups(data("ADMIN"), f(), NOW);
    expect(g.map((x) => x.label)).toEqual(["Teams", "Clients"]);
    expect(rows(g[0]!)).toEqual(["Graphic 6", "Social 1"]); // SEO 0h hidden
    expect(rows(g[1]!)).toEqual(["Repo 4", "Zenith Foods 3"]);
  });

  it("follows the dock filters; a picked team lists its Team Leader + executives", () => {
    const g = summaryGroups(data("ADMIN"), f({ row1: "team1" }), NOW);
    expect(g[0]!.label).toBe("Graphic · people");
    expect(rows(g[0]!)).toEqual(["Rishi 2", "Arush 4"]); // Dev has 0h → hidden
    expect(rows(g[1]!)).toEqual(["Repo 4", "Zenith Foods 2"]);
    const tom = summaryGroups(data("ADMIN"), f({ quick: "tomorrow" }), NOW);
    expect(rows(tom[0]!)).toEqual(["Graphic 2"]);
    // the summary's own selection, colours and icons don't narrow it; a selected 0h row stays visible
    const sel = summaryGroups(data("ADMIN"), f({ pill: "team:team3", colours: ["green"] }), NOW);
    expect(rows(sel[0]!)).toEqual(["Graphic 6", "Social 1", "SEO 0"]);
    expect(dockFilters(f({ quick: "asc", pill: "x", completed: true })).quick).toBeNull();
  });

  it("Team Leader: People (their executives) + Clients; Executive: Days + Clients", () => {
    const tl = summaryGroups(data("TEAM_LEADER"), f(), NOW);
    expect(tl.map((x) => x.label)).toEqual(["People", "Clients"]);
    expect(rows(tl[0]!)).toEqual(["Arush 4"]);
    const ex = summaryGroups(data("EXECUTIVE"), f(), NOW);
    expect(ex.map((x) => x.label)).toEqual(["Days", "Clients"]);
    expect(rows(ex[0]!)).toEqual(["Today 4", "Tom 2", "Day+2 1"]);
  });

  it("caption names the dock filters, else 'all tasks'; day chip labels", () => {
    expect(summaryCaption(data("ADMIN"), f())).toBe("all tasks");
    expect(summaryCaption(data("ADMIN"), f({ row1: "team2", row2: "c2", quick: "tomorrow" }))).toBe("Social · Zenith Foods · Tomorrow");
    expect(summaryCaption(data("ADMIN"), f({ date: "2026-10-08" }))).toBe("08 Oct");
    expect(dayLabel({ date: null, quick: "tomorrow" })).toBe("Tom");
    expect(dayLabel({ date: null, quick: "asc" })).toBeNull();
  });

  it("summary rows filter the list: person, client and the Day+2 pill", () => {
    const list = applyFilters(tasks, f({ pill: "date:day2" }), ctx("EXECUTIVE"));
    expect(list.map((t) => t.allocatedMinutes)).toEqual([60]);
  });
});
