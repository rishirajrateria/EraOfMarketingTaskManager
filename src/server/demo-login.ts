"use server";
import { randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Demo sign-in (no Google needed) for trying the three dashboards. Enabled ONLY when DEMO_LOGIN=true.
 * Creates a database session for the first active user of the chosen role and sets the NextAuth cookie.
 */
export async function demoLoginEnabled(): Promise<boolean> {
  return process.env.DEMO_LOGIN === "true";
}

const DEMO_ROLES: Role[] = ["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR"];

/** NextAuth uses the __Secure- cookie on HTTPS; detect it from the request (works behind Render/Vercel proxies). */
async function cookieName(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.AUTH_URL?.startsWith("https://") ? "https" : "http");
  return proto.startsWith("https") ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export async function demoLogin(formData: FormData): Promise<void> {
  if (!(await demoLoginEnabled())) throw new Error("Demo login is disabled");
  const role = String(formData.get("role") ?? "") as Role;
  if (!DEMO_ROLES.includes(role)) throw new Error("Unknown role");
  const user = await prisma.user.findFirst({ where: { role, active: true }, orderBy: { createdAt: "asc" } });
  if (!user) throw new Error(`No ${role} user exists yet — run npm run db:seed`);
  const jar = await cookies();
  const name = await cookieName();
  const existing = jar.get(name)?.value;
  if (existing) await prisma.session.deleteMany({ where: { sessionToken: existing } });
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 7 * 24 * 3600_000);
  await prisma.session.create({ data: { sessionToken: token, userId: user.id, expires } });
  jar.set(name, token, { httpOnly: true, sameSite: "lax", secure: name.startsWith("__Secure-"), path: "/", expires });
  redirect(role === "HR" ? "/attendance" : "/dashboard");
}

export async function demoRoles(): Promise<{ role: Role; name: string; email: string }[]> {
  if (!(await demoLoginEnabled())) return [];
  const users = await prisma.user.findMany({ where: { role: { in: DEMO_ROLES }, active: true }, orderBy: { createdAt: "asc" } });
  const seen = new Set<Role>();
  return users.filter((u) => (seen.has(u.role) ? false : (seen.add(u.role), true))).map((u) => ({ role: u.role, name: u.name, email: u.email }));
}
