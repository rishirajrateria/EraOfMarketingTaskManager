"use client";
import { useEffect } from "react";
import { ErrorScreen } from "@/components/shell/ErrorScreen";

/** Route-level error boundary (ADR 0020): friendly message, retry, and a way home. No stack trace in production. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui] route error", error.digest ?? "", error);
  }, [error]);
  return <ErrorScreen title="Something went wrong" message="We couldn't load this page. Your data is safe. Please try again." onRetry={reset} digest={error.digest} devDetail={error.message} />;
}
