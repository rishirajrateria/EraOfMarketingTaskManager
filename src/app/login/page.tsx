import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { env } from "@/lib/env";

const ERRORS: Record<string, string> = {
  NotInvited: "This Google account has not been added by an Admin yet.",
  AccessDenied: "Only accounts on the company Google Workspace can sign in.",
  Configuration: "Sign-in is not configured. Check AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const sp = await searchParams;
  const error = sp.error ? (ERRORS[sp.error] ?? "Sign-in failed. Please try again.") : null;
  return (
    <main className="phone-frame items-center justify-center bg-brand-blue text-white">
      <div className="w-full px-8 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/15 text-4xl font-black">E</div>
        <h1 className="text-2xl font-bold">EraOfMarketing Tasks</h1>
        <p className="mt-2 text-sm text-white/80">Sign in with your {env.workspaceDomain || "company"} Google account.</p>
        {error ? <p className="mt-4 rounded-lg bg-red-500/30 px-3 py-2 text-sm">{error}</p> : null}
        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: sp.callbackUrl ?? "/" });
          }}
        >
          <button className="touch-target w-full rounded-xl bg-white px-4 py-3 font-semibold text-brand-blue shadow" type="submit">
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
