"use server";
import { signOut } from "@/lib/auth";

/**
 * The "Sign out?" sheet's red button (prototype `signOutSheet`): NextAuth's own sign-out — the database session row is
 * deleted and the session cookie cleared (demo sessions use the same cookie) — then the browser lands on /login.
 */
export async function signOutNow(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
