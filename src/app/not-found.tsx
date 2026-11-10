import { ErrorScreen } from "@/components/shell/ErrorScreen";

/** 404 (ADR 0020). */
export default function NotFound() {
  return <ErrorScreen title="Page not found" message="This page doesn't exist or you may not have access to it." />;
}
