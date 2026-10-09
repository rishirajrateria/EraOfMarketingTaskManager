/**
 * Demo seed (SPEC §14): teams, users, clients, work types and tasks in every colour state.
 * Run: npm run db:seed   (idempotent — re-running resets demo tasks)
 */
import { PrismaClient } from "@prisma/client";
import { addDays, addHours, subDays, subHours } from "date-fns";
import { readFileSync } from "fs";
import path from "path";

const prisma = new PrismaClient();
const DOMAIN = process.env.GOOGLE_WORKSPACE_DOMAIN || "eraofmarketing.com";
const email = (local: string) => `${local}@${DOMAIN}`;
const asset = (name: string) => readFileSync(path.join(__dirname, "seed-assets", name));

/** The owner's real company details, as printed on their invoices (ADR 0007). */
const COMPANY = {
  companyName: "The Era Of Marketing",
  legalName: "The Era Of Marketing",
  gstNumber: "19CEWPR5040D1Z3",
  stateCode: "19",
  pan: "CEWPR5040D",
  iecCode: "CEWPR5040D",
  lutNumber: "AD190424009251F",
  address: "7th floor, Yamuna Building, 86 Golaghata Rd, Kolkata, West Bengal 700048, India",
  email: "contact@theeraofmarketing.com",
  phone: "918910358506",
  website: "www.theeraofmarketing.com",
  hsnSacCode: "998361",
  bankAccountName: "The Era Of Marketing",
  bankAccountNumber: "10126079826",
  bankSwift: "IDFBINBBMUM",
  bankIfsc: "IDFB0060102",
  bankName: "IDFC FIRST Bank LTD",
  bankAddress: "Salt Lake, Sector 1, Kolkata, West Bengal, India, Pincode 700064",
  logoData: asset("logo.png"),
  logoUrl: "/api/files/logo",
  signatureData: asset("signature.png"),
  signatureUrl: "/api/files/signature",
};

async function main() {
  await prisma.companySettings.upsert({
    where: { id: "default" },
    update: COMPANY,
    create: { id: "default", ...COMPANY },
  });

  // A legacy demo "Design" team becomes "Graphic" (ADR 0008 demo data mirrors the prototype).
  const legacyDesign = await prisma.team.findUnique({ where: { name: "Design" } });
  if (legacyDesign && !(await prisma.team.findUnique({ where: { name: "Graphic" } }))) await prisma.team.update({ where: { id: legacyDesign.id }, data: { name: "Graphic" } });
  const teamsData = ["Graphic", "Finance", "Website", "Video", "Write", "Social", "SEO"];
  const colours = ["#2563eb", "#16a34a", "#9333ea", "#dc2626", "#f59e0b", "#db2777", "#0d9488", "#64748b"];
  const teams = await Promise.all(
    teamsData.map((name, i) => prisma.team.upsert({ where: { name }, update: {}, create: { name, colour: colours[i]! } })),
  );

  const up = (e: string, name: string, role: "ADMIN" | "TEAM_LEADER" | "EXECUTIVE" | "HR" | "CA", teamId?: string, teamLeaderId?: string) =>
    prisma.user.upsert({
      where: { email: e },
      update: { role, teamId: teamId ?? null, teamLeaderId: teamLeaderId ?? null, active: true },
      create: { email: e, name, role, teamId, teamLeaderId, activatedAt: new Date() },
    });

  const admin = await up(email("admin"), "Admin Rishi", "ADMIN");
  const hr = await up(email("hr"), "Priya HR", "HR");
  await up(email("ca"), "CA Mehta", "CA");
  const social = teams[5]!;
  const seo = teams[6]!; // no Team Leader on purpose: Add task shows "That team has no Team Leader yet"
  const rishi = await up(email("rishi"), "Rishi Kumar", "TEAM_LEADER", teams[0]!.id);
  const neha = await up(email("neha"), "Neha Sharma", "TEAM_LEADER", social.id);
  const arush = await up(email("arush"), "Arush Verma", "EXECUTIVE", teams[0]!.id, rishi.id);
  const dev = await up(email("dev"), "Dev Patel", "EXECUTIVE", teams[0]!.id, rishi.id);
  const isha = await up(email("isha"), "Isha Rao", "EXECUTIVE", social.id, neha.id);
  const arjun = await up(email("arjun"), "Arjun Kumar", "EXECUTIVE", social.id, neha.id);
  // One Team Leader per team, kept in sync with Team.leaderId.
  await prisma.team.updateMany({ where: { leaderId: { in: [rishi.id, neha.id] } }, data: { leaderId: null } });
  await prisma.team.update({ where: { id: teams[0]!.id }, data: { leaderId: rishi.id } });
  await prisma.team.update({ where: { id: social.id }, data: { leaderId: neha.id } });

  const clientsData = ["Repo", "Robam", "Pharma Bag Co", "Sunrise Realty"];
  const clientExtras: Record<string, { businessName: string; pan: string; tdsPercent?: number }> = {
    Repo: { businessName: "Repo Technologies Pvt Ltd", pan: "AAACR1234B", tdsPercent: 10 },
    Robam: { businessName: "Robam Appliances India LLP", pan: "AABFR5678C", tdsPercent: 2 },
    "Pharma Bag Co": { businessName: "Pharma Bag Company", pan: "AAEPP9012D" },
    "Sunrise Realty": { businessName: "Sunrise Realty Developers Pvt Ltd", pan: "AABCS3456E", tdsPercent: 10 },
  };
  const clients = await Promise.all(
    clientsData.map((name) =>
      prisma.client.upsert({
        where: { name },
        update: { businessName: clientExtras[name]!.businessName, pan: clientExtras[name]!.pan, tdsPercent: clientExtras[name]!.tdsPercent ?? null },
        create: { name, ...clientExtras[name]!, email: `billing@${name.toLowerCase().replace(/\s+/g, "")}.example`, gstNumber: "29XXXXX1234X1Z1", address: "Bengaluru", visibleInFilters: true },
      }),
    ),
  );

  // Demo bills (ADR 0006 + 0009): monthly rent paid this month with TDS (over the threshold) and a GST bill to claim,
  // the next rent due; a one-time design tool subscription already paid.
  const seedNow = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const day = (offset: number) => new Date(Date.UTC(seedNow.getUTCFullYear(), seedNow.getUTCMonth(), seedNow.getUTCDate() + offset, 6, 30));
  const demoBills = [
    {
      note: "[demo] Studio rent",
      bill: { vendor: "Skyline Spaces", category: "Rent", amount: 25000, plan: "RECURRING" as const, timing: "PREPAID" as const, vendorGstin: "29ABCDE1234F1Z5", repeatRule: { freq: "MONTHLY", interval: 1, weekdays: [], monthMode: "DATE", monthDay: 1, nth: 1, nthWeekday: 1, yearMonth: 1, yearDay: 1, endsType: "NEVER", anchorDate: ymd(day(-5)) } },
      occ: [
        { seq: 1, amount: 25000, dueDate: day(-5), status: "PAID" as const, paidAt: day(-4), method: "BANK" as const, tdsPercent: 10, tdsAmount: 2500, gstAmount: 3814, gstRate: 18, vendorGstin: "29ABCDE1234F1Z5", itcClaimable: true },
        { seq: 2, amount: 25000, dueDate: day(26), status: "DUE" as const },
      ],
    },
    {
      note: "[demo] Design tool subscription",
      bill: { vendor: "Figma", category: "Software", amount: 1800, plan: "ONE_TIME" as const, timing: "PREPAID" as const },
      occ: [{ seq: 1, amount: 1800, dueDate: day(-2), status: "PAID" as const, paidAt: day(-2), method: "CARD" as const }],
    },
  ];
  for (const e of demoBills) {
    const existing = await prisma.expense.findFirst({ where: { note: e.note } });
    if (!existing) await prisma.expense.create({ data: { ...e.bill, note: e.note, date: e.occ[0].dueDate, createdById: admin.id, occurrences: { create: e.occ } } });
  }

  // Work types belong to teams (ADR 0008); "Reporting" is done by every team.
  const graphic = teams[0]!;
  const wtSpec: [string, string[]][] = [
    ["Content", [social.id, seo.id]],
    ["Graphic design", [graphic.id]],
    ["Ads", [social.id]],
    ["Reporting", teams.map((t) => t.id)],
    ["Reels", [social.id]],
    ["Logo", [graphic.id]],
    ["Keyword research", [seo.id]],
    ["On-page SEO", [seo.id]],
  ];
  const workTypes = await Promise.all(
    wtSpec.map(([name, teamIds], i) =>
      prisma.workType.upsert({
        where: { name },
        update: { active: true, teams: { set: teamIds.map((id) => ({ id })) } },
        create: { name, colour: colours[i % colours.length]!, teams: { connect: teamIds.map((id) => ({ id })) } },
      }),
    ),
  );
  const wt = (name: string) => workTypes.findIndex((w) => w.name === name);
  // Older demo tags (no team) are retired so the WORK row only shows team work types.
  await prisma.workType.updateMany({ where: { name: { in: ["Pharma bag", "Robam", "Social post", "Landing page", "Reel"] } }, data: { active: false } });
  // Specialities ("✓" in Add task / Assign executive): executives get two each.
  const skills: [typeof rishi, string[]][] = [
    [rishi, ["Graphic design"]],
    [neha, ["Content", "Reporting"]],
    [arush, ["Logo", "Graphic design"]],
    [dev, ["Graphic design", "Reporting"]],
    [isha, ["Content", "Reporting"]],
    [arjun, ["Reels", "Ads"]],
  ];
  for (const [u, names] of skills) {
    await prisma.user.update({ where: { id: u.id }, data: { specialities: { set: names.map((n) => ({ id: workTypes[wt(n)]!.id })) } } });
  }

  // Reset demo tasks
  await prisma.task.deleteMany({ where: { title: { startsWith: "[demo]" } } });

  const now = new Date();
  const at = (h: number, dayOffset = 0) => {
    const d = addDays(now, dayOffset);
    d.setUTCHours(h - 5, 30, 0, 0); // h:00 IST
    return d;
  };

  type Spec = {
    title: string; client: number; assignees: string[]; teams: string[]; minutes: number; start: Date; end: Date;
    status?: "ASSIGNED" | "STARTED" | "PAUSED" | "FINISH_REQUESTED" | "COMPLETED"; overdue?: boolean; doubt?: string; review?: string;
    important?: boolean; tags?: number[]; type?: "WORK" | "MEETING"; self?: boolean; createdBy?: string; prefs?: string[];
  };
  const specs: Spec[] = [
    { title: "[demo] Repo Instagram carousel", client: 0, assignees: [rishi.id], teams: [teams[0]!.id], minutes: 240, start: at(10), end: at(14), tags: [wt("Graphic design")] },
    { title: "[demo] Robam product shoot edit", client: 1, assignees: [rishi.id, arush.id], teams: [teams[0]!.id, teams[3]!.id], minutes: 330, start: at(10), end: at(16), status: "STARTED", tags: [wt("Graphic design")] },
    { title: "[demo] Pharma bag packaging v3", client: 2, assignees: [rishi.id], teams: [teams[0]!.id], minutes: 180, start: at(15), end: at(18), doubt: "Client sent two conflicting logo files — which one?", tags: [wt("Logo")] },
    { title: "[demo] Sunrise landing page copy", client: 3, assignees: [neha.id, isha.id], teams: [social.id], minutes: 120, start: subHours(at(10), 24), end: subHours(at(12), 24), overdue: true, tags: [wt("Content")] },
    { title: "[demo] Repo monthly report", client: 0, assignees: [rishi.id], teams: [teams[1]!.id], minutes: 60, start: subDays(at(11), 2), end: subDays(at(12), 2), status: "COMPLETED", tags: [wt("Reporting")] },
    { title: "[demo] Robam reel cut", client: 1, assignees: [arush.id], teams: [teams[3]!.id], minutes: 90, start: at(11, 1), end: at(12, 1), status: "PAUSED", review: "Need 2 more hours", tags: [wt("Graphic design")] },
    { title: "[demo] Weekly client sync", client: 0, assignees: [admin.id, rishi.id], teams: [], minutes: 30, start: addHours(now, 3), end: addHours(now, 3.5), type: "MEETING" },
    { title: "[demo] Admin planning block", client: 0, assignees: [admin.id], teams: [], minutes: 120, start: at(16, 1), end: at(18, 1), important: true, self: true },
    { title: "[demo] Dev portfolio refresh", client: 3, assignees: [dev.id], teams: [teams[0]!.id], tags: [wt("Graphic design")], minutes: 120, start: at(10, 2), end: at(12, 2), self: true, createdBy: dev.id },
    { title: "[demo] Pharma bag social calendar", client: 2, assignees: [rishi.id], teams: [teams[0]!.id], minutes: 240, start: at(10, 2), end: at(14, 2), status: "FINISH_REQUESTED", tags: [wt("Reporting")] },
    // Admin → Graphic team: waits for Rishi (TL, the demo Team Leader) to assign; Admin prefers Arush (ADR 0008).
    { title: "[demo] Festive logo refresh — Robam", client: 1, assignees: [rishi.id], teams: [graphic.id], minutes: 120, start: at(14, 1), end: at(16, 1), tags: [wt("Logo")], prefs: [arush.id] },
  ];

  for (const s of specs) {
    const status = s.status ?? "ASSIGNED";
    const started = status === "STARTED" || status === "PAUSED" || status === "FINISH_REQUESTED" || status === "COMPLETED";
    const t = await prisma.task.create({
      data: {
        title: s.title,
        description: `<p>Demo task for <b>${clientsData[s.client]}</b>.</p>`,
        type: s.type ?? "WORK",
        clientId: clients[s.client]!.id,
        createdById: s.createdBy ?? admin.id,
        assignedById: s.createdBy ?? admin.id,
        allocatedMinutes: s.minutes,
        scheduledStart: s.start,
        scheduledEnd: s.end,
        status,
        statusBeforePause: status === "PAUSED" ? "STARTED" : null,
        pausedAt: status === "PAUSED" ? subHours(now, 1) : null,
        actualStart: started ? s.start : null,
        actualEnd: status === "COMPLETED" ? s.end : null,
        approvedAt: status === "COMPLETED" ? s.end : null,
        approvedById: status === "COMPLETED" ? admin.id : null,
        overdue: !!s.overdue,
        doubtRaised: !!s.doubt,
        doubtNote: s.doubt,
        reviewRequested: !!s.review,
        reviewNote: s.review,
        important: !!s.important,
        selfAssigned: !!s.self,
        protected: !!s.self && s.assignees[0] === admin.id,
        finishRequestedAt: status === "FINISH_REQUESTED" ? subHours(now, 2) : null,
        finishRequestedById: status === "FINISH_REQUESTED" ? rishi.id : null,
        driveFolderId: s.type === "MEETING" ? null : `folder_demo_${s.title.length}`,
        driveFolderUrl: s.type === "MEETING" ? null : "https://drive.google.com/drive/folders/demo",
        meetLink: "https://meet.google.com/abc-defg-hij",
        meetActive: status !== "COMPLETED",
        chatSpaceUrl: s.type === "MEETING" ? null : "https://chat.google.com/room/demo",
        preferredAssigneeIds: s.prefs ?? [],
        assignees: { create: s.assignees.map((userId) => ({ userId })) },
        teams: { create: s.teams.map((teamId) => ({ teamId })) },
        tags: { create: (s.tags ?? []).map((i) => ({ workTypeId: workTypes[i]!.id })) },
      },
    });
    if (started) await prisma.taskSession.create({ data: { taskId: t.id, startedAt: s.start, endedAt: status === "STARTED" ? null : s.end } });
    if (s.doubt) await prisma.request.create({ data: { type: "DOUBT", taskId: t.id, raisedById: rishi.id, targetRole: "ADMIN", note: s.doubt } });
    if (s.review) await prisma.request.create({ data: { type: "TIME_CHANGE", taskId: t.id, raisedById: arush.id, targetRole: "ADMIN", note: s.review } });
    if (status === "FINISH_REQUESTED") await prisma.request.create({ data: { type: "FINISH", taskId: t.id, raisedById: rishi.id, targetRole: "ADMIN", note: "" } });
  }

  // Attendance for the last 5 days + a pending leave
  for (const u of [rishi, arush, dev, neha, isha, arjun]) {
    for (let i = 1; i <= 5; i++) {
      const d = subDays(now, i);
      const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      if (date.getUTCDay() === 0) continue;
      await prisma.attendance.upsert({
        where: { userId_date: { userId: u.id, date } },
        update: {},
        create: { userId: u.id, date, status: i === 3 && u.id === dev.id ? "ABSENT" : "PRESENT", checkIn: addHours(date, 4.5), checkOut: addHours(date, 13.5), markedById: hr.id },
      });
    }
  }
  const leaveFrom = addDays(now, 7);
  const lf = new Date(Date.UTC(leaveFrom.getUTCFullYear(), leaveFrom.getUTCMonth(), leaveFrom.getUTCDate()));
  const existingLeave = await prisma.leave.findFirst({ where: { userId: arush.id, from: lf } });
  if (!existingLeave) {
    const leave = await prisma.leave.create({ data: { userId: arush.id, from: lf, to: addDays(lf, 1), reason: "Family function" } });
    await prisma.request.create({ data: { type: "LEAVE", leaveId: leave.id, raisedById: arush.id, targetRole: "HR", note: "Family function" } });
  }

  console.log("Seeded. Sign in as:", email("admin"), "(ADMIN),", email("rishi"), "(TL),", email("arush"), "(EXEC),", email("hr"), "(HR)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
