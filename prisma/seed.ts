/**
 * Demo seed (SPEC §14): teams, users, clients, work types and tasks in every colour state.
 * Run: npm run db:seed   (idempotent — re-running resets demo tasks)
 */
import { PrismaClient } from "@prisma/client";
import { addDays, addHours, subDays, subHours } from "date-fns";

const prisma = new PrismaClient();
const DOMAIN = process.env.GOOGLE_WORKSPACE_DOMAIN || "eraofmarketing.com";
const email = (local: string) => `${local}@${DOMAIN}`;

async function main() {
  await prisma.companySettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      companyName: "Era Of Marketing",
      address: "2nd Floor, Marketing House, Bengaluru 560001",
      gstNumber: "29ABCDE1234F1Z5",
      bankName: "HDFC Bank",
      bankAccountName: "Era Of Marketing",
      bankAccountNumber: "50100123456789",
      bankIfsc: "HDFC0001234",
      upiId: "eraofmarketing@hdfcbank",
    },
  });

  const teamsData = ["Graphic", "Finance", "Website", "Video", "Write"];
  const colours = ["#2563eb", "#16a34a", "#9333ea", "#dc2626", "#f59e0b"];
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
  const rishi = await up(email("rishi"), "Rishi Kumar", "TEAM_LEADER", teams[0]!.id);
  const neha = await up(email("neha"), "Neha Sharma", "TEAM_LEADER", teams[2]!.id);
  const arush = await up(email("arush"), "Arush Verma", "EXECUTIVE", teams[0]!.id, rishi.id);
  const dev = await up(email("dev"), "Dev Patel", "EXECUTIVE", teams[0]!.id, rishi.id);
  const isha = await up(email("isha"), "Isha Rao", "EXECUTIVE", teams[2]!.id, neha.id);
  await prisma.team.update({ where: { id: teams[0]!.id }, data: { leaderId: rishi.id } });
  await prisma.team.update({ where: { id: teams[2]!.id }, data: { leaderId: neha.id } });

  const clientsData = ["Repo", "Robam", "Pharma Bag Co", "Sunrise Realty"];
  const clients = await Promise.all(
    clientsData.map((name) => prisma.client.upsert({ where: { name }, update: {}, create: { name, email: `billing@${name.toLowerCase().replace(/\s+/g, "")}.example`, gstNumber: "29XXXXX1234X1Z1", address: "Bengaluru", visibleInFilters: true } })),
  );

  const wts = ["Pharma bag", "Robam", "Social post", "Landing page", "Reel"];
  const workTypes = await Promise.all(wts.map((name, i) => prisma.workType.upsert({ where: { name }, update: {}, create: { name, colour: colours[i]! } })));

  // Reset demo tasks
  await prisma.task.deleteMany({ where: { createdById: admin.id, title: { startsWith: "[demo]" } } });

  const now = new Date();
  const at = (h: number, dayOffset = 0) => {
    const d = addDays(now, dayOffset);
    d.setUTCHours(h - 5, 30, 0, 0); // h:00 IST
    return d;
  };

  type Spec = {
    title: string; client: number; assignees: string[]; teams: string[]; minutes: number; start: Date; end: Date;
    status?: "ASSIGNED" | "STARTED" | "PAUSED" | "FINISH_REQUESTED" | "COMPLETED"; overdue?: boolean; doubt?: string; review?: string;
    important?: boolean; tags?: number[]; type?: "WORK" | "MEETING"; self?: boolean; createdBy?: string;
  };
  const specs: Spec[] = [
    { title: "[demo] Repo Instagram carousel", client: 0, assignees: [rishi.id], teams: [teams[0]!.id], minutes: 240, start: at(10), end: at(14), tags: [2] },
    { title: "[demo] Robam product shoot edit", client: 1, assignees: [rishi.id, arush.id], teams: [teams[0]!.id, teams[3]!.id], minutes: 330, start: at(10), end: at(16), status: "STARTED", tags: [1] },
    { title: "[demo] Pharma bag packaging v3", client: 2, assignees: [rishi.id], teams: [teams[0]!.id], minutes: 180, start: at(15), end: at(18), doubt: "Client sent two conflicting logo files — which one?", tags: [0] },
    { title: "[demo] Sunrise landing page copy", client: 3, assignees: [neha.id, isha.id], teams: [teams[2]!.id, teams[4]!.id], minutes: 120, start: subHours(at(10), 24), end: subHours(at(12), 24), overdue: true, tags: [3] },
    { title: "[demo] Repo monthly report", client: 0, assignees: [rishi.id], teams: [teams[1]!.id], minutes: 60, start: subDays(at(11), 2), end: subDays(at(12), 2), status: "COMPLETED" },
    { title: "[demo] Robam reel cut", client: 1, assignees: [arush.id], teams: [teams[3]!.id], minutes: 90, start: at(11, 1), end: at(12, 1), status: "PAUSED", review: "Need 2 more hours", tags: [4] },
    { title: "[demo] Weekly client sync", client: 0, assignees: [admin.id, rishi.id], teams: [], minutes: 30, start: addHours(now, 3), end: addHours(now, 3.5), type: "MEETING" },
    { title: "[demo] Admin planning block", client: 0, assignees: [admin.id], teams: [], minutes: 120, start: at(16, 1), end: at(18, 1), important: true, self: true },
    { title: "[demo] Dev portfolio refresh", client: 3, assignees: [dev.id], teams: [teams[2]!.id], minutes: 120, start: at(10, 2), end: at(12, 2), self: true, createdBy: dev.id },
    { title: "[demo] Pharma bag social calendar", client: 2, assignees: [rishi.id], teams: [teams[0]!.id], minutes: 240, start: at(10, 2), end: at(14, 2), status: "FINISH_REQUESTED", tags: [0, 2] },
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
  for (const u of [rishi, arush, dev, neha, isha]) {
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
