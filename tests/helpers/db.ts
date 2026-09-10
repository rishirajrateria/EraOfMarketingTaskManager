import { PrismaClient } from "@prisma/client";

/**
 * Integration-test DB helper. Uses TEST_DATABASE_URL (default: local taskmanager_test).
 * `resetDb()` truncates every table between tests.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/taskmanager_test?schema=public";

export const testDb = new PrismaClient();

export async function resetDb() {
  const tables = await testDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const names = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  if (names) await testDb.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

export async function seedBasics() {
  const admin = await testDb.user.create({ data: { email: "admin@test.local", name: "Admin", role: "ADMIN", activatedAt: new Date() } });
  const team = await testDb.team.create({ data: { name: "Graphic" } });
  const tl = await testDb.user.create({ data: { email: "tl@test.local", name: "Rishi", role: "TEAM_LEADER", teamId: team.id, activatedAt: new Date() } });
  await testDb.team.update({ where: { id: team.id }, data: { leaderId: tl.id } });
  const exec = await testDb.user.create({ data: { email: "exec@test.local", name: "Arush", role: "EXECUTIVE", teamId: team.id, teamLeaderId: tl.id, activatedAt: new Date() } });
  const hr = await testDb.user.create({ data: { email: "hr@test.local", name: "HR", role: "HR", activatedAt: new Date() } });
  const client = await testDb.client.create({ data: { name: "Repo", visibleInFilters: true } });
  await testDb.companySettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  return { admin, team, tl, exec, hr, client };
}
