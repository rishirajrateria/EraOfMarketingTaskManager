import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { env } from "@/lib/env";

const ERRORS: Record<string, string> = {
  NotInvited: "This Google account has not been added by an Admin yet.",
  RoleParked: "Accountant (CA) access is not enabled. Please ask the Admin.",
  AccessDenied: "Only accounts on the company Google Workspace can sign in.",
  Configuration: "Sign-in is not configured. Check AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const sp = await searchParams;
  const error = sp.error ? (ERRORS[sp.error] ?? "Sign-in failed. Please try again.") : null;
  // Only same-site relative paths may be used as the post-login destination (no open redirects).
  const redirectTo = sp.callbackUrl && /^\/(?!\/)/.test(sp.callbackUrl) ? sp.callbackUrl : "/";
  return (
    <main className="phone-frame items-center justify-center bg-gradient-to-br from-[#1e63d6]/90 via-[#22c3e6]/80 to-[#5fc46a]/80 text-white">
      <div className="glass mx-6 w-full rounded-3xl px-8 py-10 text-center text-gray-900">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#1e63d6] to-[#22c3e6] text-4xl font-black text-white shadow-lg">E</div>
        <h1 className="text-2xl font-bold">EraOfMarketing Tasks</h1>
        <p className="mt-2 text-sm text-gray-600">Sign in with your {env.workspaceDomain || "company"} Google account.</p>
        {error ? <p className="mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo });
          }}
        >
          <button className="touch-target w-full rounded-xl bg-gradient-to-b from-[#2f74e6] to-[#1e63d6] px-4 py-3 font-semibold text-white shadow-[0_8px_20px_rgba(30,99,214,.35),inset_0_1px_0_rgba(255,255,255,.35)]" type="submit">
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
