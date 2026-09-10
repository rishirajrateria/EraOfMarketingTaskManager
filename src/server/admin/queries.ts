import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";

/** Read-side queries for the admin screens. Results are plain, RSC-serialisable objects. */

const ROLE_ORDER = ["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR", "CA"] as const;

export async function listPeople() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      role: true,
      teamId: true,
      teamLeaderId: true,
      dailyCapacityMinutes: true,
      workingDays: true,
      active: true,
      activatedAt: true,
      team: { select: { name: true } },
      teamLeader: { select: { name: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return users.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}
export type PersonRow = Awaited<ReturnType<typeof listPeople>>[number];

export async function listTeamOptions() {
  return prisma.team.findMany({ where: { active: true }, select: { id: true, name: true, colour: true }, orderBy: { name: "asc" } });
}
export type TeamOption = Awaited<ReturnType<typeof listTeamOptions>>[number];

export async function listLeaderOptions() {
  return prisma.user.findMany({
    where: { role: "TEAM_LEADER", active: true },
    select: { id: true, name: true, teamId: true },
    orderBy: { name: "asc" },
  });
}
export type LeaderOption = Awaited<ReturnType<typeof listLeaderOptions>>[number];

export async function listTeams() {
  return prisma.team.findMany({
    select: {
      id: true,
      name: true,
      colour: true,
      leaderId: true,
      active: true,
      leader: { select: { name: true } },
      _count: { select: { members: { where: { active: true } } } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}
export type TeamRow = Awaited<ReturnType<typeof listTeams>>[number];

export async function listClients() {
  return prisma.client.findMany({
    select: {
      id: true,
      name: true,
      contact: true,
      email: true,
      gstNumber: true,
      address: true,
      driveFolderId: true,
      visibleInFilters: true,
      active: true,
      _count: { select: { tasks: { where: { deletedAt: null } }, vaultItems: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}
export type ClientRow = Awaited<ReturnType<typeof listClients>>[number];

export async function listWorkTypes() {
  return prisma.workType.findMany({
    select: { id: true, name: true, colour: true, active: true, _count: { select: { tasks: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}
export type WorkTypeRow = Awaited<ReturnType<typeof listWorkTypes>>[number];

/** CompanySettings without binary/Decimal fields so it can cross the RSC boundary. */
export async function getSettingsDto() {
  const s = await getSettings();
  return {
    companyName: s.companyName,
    address: s.address,
    gstNumber: s.gstNumber,
    bankName: s.bankName,
    bankAccountName: s.bankAccountName,
    bankAccountNumber: s.bankAccountNumber,
    bankIfsc: s.bankIfsc,
    upiId: s.upiId,
    logoUrl: s.logoUrl,
    hasLogo: Boolean(s.logoData),
    workStartMinutes: s.workStartMinutes,
    workEndMinutes: s.workEndMinutes,
    lunchStartMinutes: s.lunchStartMinutes,
    lunchEndMinutes: s.lunchEndMinutes,
    workingDays: s.workingDays,
    holidays: s.holidays.map((d) => dateKey(d, "UTC")),
    timezone: s.timezone,
    invoicePrefix: s.invoicePrefix,
    invoiceNextNumber: s.invoiceNextNumber,
    receiptPrefix: s.receiptPrefix,
    receiptNextNumber: s.receiptNextNumber,
    invoiceTerms: s.invoiceTerms,
    invoiceEmailTemplate: s.invoiceEmailTemplate,
    defaultGstPercent: Number(s.defaultGstPercent),
    notifyEmailDefault: s.notifyEmailDefault,
    notifyChatDefault: s.notifyChatDefault,
    restartCreatesNewWorkspace: s.restartCreatesNewWorkspace,
    recurrenceCreatesNewWorkspace: s.recurrenceCreatesNewWorkspace,
    updatedAt: s.updatedAt.toISOString(),
  };
}
export type SettingsDto = Awaited<ReturnType<typeof getSettingsDto>>;

/** Read-only Google integration status for the settings screen (SPEC §11.9). */
export function googleIntegrationStatus() {
  return {
    mode: env.googleMock ? ("Mock mode" as const) : ("Live" as const),
    serviceAccountKeySet: Boolean(env.serviceAccountKeyB64),
    impersonateUser: env.impersonateUser || null,
    workspaceDomain: env.workspaceDomain || null,
    driveRootFolderId: env.driveRootFolderId || null,
    financeSheetId: env.financeSheetId || null,
    expensesSheetId: env.expensesSheetId || null,
  };
}
export type GoogleStatus = ReturnType<typeof googleIntegrationStatus>;

export async function getMyProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      role: true,
      notifyByEmail: true,
      dailyCapacityMinutes: true,
      workingDays: true,
      team: { select: { name: true, colour: true } },
      teamLeader: { select: { name: true } },
    },
  });
}
export type MyProfile = NonNullable<Awaited<ReturnType<typeof getMyProfile>>>;
