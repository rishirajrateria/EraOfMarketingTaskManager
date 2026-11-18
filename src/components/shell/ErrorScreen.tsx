/**
 * Friendly full-screen message used by the error boundaries and the 404 page (ADR 0020). Glass style, theme tokens
 * (so light and dark both read well), mobile first. Never renders a stack trace: in production only an opaque
 * reference (Next's error digest) is shown; the raw message appears in development only.
 */
type Props = {
  title: string;
  message: string;
  /** Present for error boundaries: renders the "Try again" button. */
  onRetry?: () => void;
  /** Next's error digest (production) — lets the owner find the server log line. */
  digest?: string;
  /** Development-only detail (the thrown message); ignored in production builds. */
  devDetail?: string;
};

export function ErrorScreen({ title, message, onRetry, digest, devDetail }: Props) {
  const showDev = process.env.NODE_ENV !== "production" && devDetail;
  return (
    <main className="phone-frame items-center justify-center p-6">
      <div className="glass w-full rounded-3xl px-6 py-9 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1e63d6] to-[#22c3e6] text-3xl font-black text-white shadow-lg" aria-hidden="true">
          E
        </div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        {showDev ? <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-chip p-3 text-left text-[11px] text-ink">{devDetail}</pre> : null}
        {digest ? <p className="mt-3 text-[11px] text-muted">Reference: {digest}</p> : null}
        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {onRetry ? (
            <button type="button" onClick={onRetry} className="touch-target rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-ink">
              Try again
            </button>
          ) : null}
          {/* A plain anchor, not next/link: after a crash a full navigation is the safest way back. */}
          <a href="/dashboard" className="touch-target glass-chip rounded-xl px-5 py-3 text-sm font-semibold text-ink">
            Go to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
