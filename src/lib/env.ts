import { parseDomains } from "@/lib/domains";

/** GOOGLE_WORKSPACE_DOMAIN may list several domains ("theeraofmarketing.com,eraofmarketing.com"); GOOGLE_WORKSPACE_DOMAINS is an alias. */
const workspaceDomains = parseDomains(process.env.GOOGLE_WORKSPACE_DOMAIN, process.env.GOOGLE_WORKSPACE_DOMAINS);

export const env = {
  /** Allowed sign-in / invite domains; the first is the staff domain (ADR 0018). Empty = any domain. */
  workspaceDomains,
  /** Back-compat: the first (staff) domain, or "". */
  workspaceDomain: workspaceDomains[0] ?? "",
  bootstrapAdmins: (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  googleMock: (process.env.GOOGLE_MOCK ?? "true") !== "false",
  timezone: process.env.COMPANY_TIMEZONE ?? "Asia/Kolkata",
  cronSecret: process.env.CRON_SECRET ?? "",
  jobsInline: (process.env.JOBS_INLINE ?? "true") !== "false",
  vaultKey: process.env.VAULT_ENCRYPTION_KEY ?? "",
  vapidPublic: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  vapidPrivate: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  driveRootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "",
  financeSheetId: process.env.GOOGLE_FINANCE_SHEET_ID ?? "",
  expensesSheetId: process.env.GOOGLE_EXPENSES_SHEET_ID ?? "",
  impersonateUser: process.env.GOOGLE_IMPERSONATE_USER ?? "",
  /** Mailbox finance mail is sent from (invoices, receipts, reminders, …); falls back to impersonateUser (ADR 0018). */
  financeSender: (process.env.GOOGLE_FINANCE_SENDER ?? "").trim().toLowerCase(),
  serviceAccountKeyB64: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 ?? "",
};
