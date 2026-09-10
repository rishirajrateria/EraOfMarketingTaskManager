import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      teamId: string | null;
      teamLeaderId: string | null;
    } & DefaultSession["user"];
  }
}

/** Incremental OAuth scopes requested at sign-in (SPEC §1). */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

function emailAllowed(email: string): boolean {
  const lower = email.toLowerCase();
  if (!env.workspaceDomain) return true;
  return lower.endsWith("@" + env.workspaceDomain.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  providers: [
    Google({
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
          ...(env.workspaceDomain ? { hd: env.workspaceDomain } : {}),
        },
      },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    /**
     * Users do not self-register (SPEC §4). Admin pre-creates the User row by email;
     * on first sign-in the row is matched by email and activated. Unknown emails are rejected,
     * except emails listed in BOOTSTRAP_ADMIN_EMAILS which are created as ADMIN.
     */
    async signIn({ user, profile }) {
      const email = (user.email ?? profile?.email ?? "").toLowerCase();
      if (!email || !emailAllowed(email)) return false;
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (!existing.active) return false;
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            googleId: (profile?.sub as string | undefined) ?? existing.googleId,
            avatar: user.image ?? existing.avatar,
            name: existing.activatedAt ? existing.name : user.name ?? existing.name,
            activatedAt: existing.activatedAt ?? new Date(),
          },
        });
        return true;
      }
      if (env.bootstrapAdmins.includes(email)) {
        await prisma.user.create({
          data: {
            email,
            name: user.name ?? email,
            avatar: user.image ?? undefined,
            role: "ADMIN",
            googleId: profile?.sub as string | undefined,
            activatedAt: new Date(),
          },
        });
        return true;
      }
      return "/login?error=NotInvited";
    },
    async session({ session, user }) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, role: true, teamId: true, teamLeaderId: true, name: true, avatar: true, active: true },
      });
      if (!dbUser) return session;
      session.user.id = dbUser.id;
      session.user.role = dbUser.role;
      session.user.teamId = dbUser.teamId;
      session.user.teamLeaderId = dbUser.teamLeaderId;
      session.user.name = dbUser.name;
      session.user.image = dbUser.avatar ?? session.user.image;
      return session;
    },
  },
  events: {
    async linkAccount({ user, account }) {
      // PrismaAdapter creates a user row before linkAccount when none exists;
      // signIn() above already ensured the row exists and is allowed.
      if (user.id && account.providerAccountId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { googleId: account.providerAccountId },
        });
      }
    },
  },
});
