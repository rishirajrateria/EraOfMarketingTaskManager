"use client";
import { useEffect } from "react";
import "./globals.css";
import { ErrorScreen } from "@/components/shell/ErrorScreen";

/** Last-resort boundary: replaces the root layout, so it renders its own <html>/<body> (ADR 0020). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui] global error", error.digest ?? "", error);
  }, [error]);
  return (
    <html lang="en">
      <body className="antialiased">
        <ErrorScreen title="Something went wrong" message="The app hit an unexpected problem. Your data is safe. Please try again." onRetry={reset} digest={error.digest} devDetail={error.message} />
      </body>
    </html>
  );
}
