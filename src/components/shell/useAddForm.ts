"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { listFlowState, withAddState, type AddState } from "@/components/shell/list-flow";

/**
 * Open / closed state of a list page's add form (people, work types, teams, client kit).
 *
 * In the "+" list flow (`?add=1|min&from=add`, ADR 0016 addendum) the URL holds it: Escape / a tap outside the sheet
 * minimises it to the bar above the bottom nav (`dismiss`), the bar expands it again (`show`), a successful save goes
 * back to the list with the bar minimised so another can be added (`saved`), and the corner × leaves for the
 * dashboard (`cancel`). Expand / minimise use `history.replaceState` (synced with `useSearchParams`, no server round
 * trip). After a save the admin action has already started `router.refresh()`, which would put the old URL back when
 * it lands, so `saved` navigates instead (`router.replace`, which supersedes that refresh and brings the fresh list) and
 * shows the bar at once meanwhile.
 *
 * Opened any other way — the page's own "+ Add", or a plain `?add=1` deep link (`openAdd`) — it is local state and
 * every one of those just closes the form, as before.
 */
export function useAddForm(openAdd = false) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const urlFlow = listFlowState(useSearchParams());
  const [pending, setPending] = useState<AddState | null>(null);
  const flow = pending ?? urlFlow;
  const [localOpen, setLocalOpen] = useState(() => openAdd && !urlFlow);

  useEffect(() => {
    if (pending && urlFlow === pending) setPending(null);
  }, [pending, urlFlow]);

  const href = useCallback((state: AddState) => withAddState(pathname, window.location.search, state), [pathname]);
  // `null` state: Next copies its own history state and syncs `useSearchParams` (passing its state would skip that).
  const setFlow = useCallback((state: AddState) => window.history.replaceState(null, "", href(state)), [href]);
  const closeOr = useCallback((inFlow: () => void) => (flow ? inFlow() : setLocalOpen(false)), [flow]);

  return {
    /** Opened by the "+" (expanded or minimised). */
    inFlow: flow !== null,
    open: flow ? flow === "open" : localOpen,
    /** The bar above the bottom nav shows (and the page hides its own "+ Add"). */
    minimised: flow === "min",
    show: useCallback(() => (flow ? setFlow("open") : setLocalOpen(true)), [flow, setFlow]),
    /** Escape / tap outside the sheet. */
    dismiss: useCallback(() => closeOr(() => setFlow("min")), [closeOr, setFlow]),
    /** The corner ×. */
    cancel: useCallback(() => closeOr(() => router.replace("/dashboard")), [closeOr, router]),
    /** After a successful save. */
    saved: useCallback(
      () =>
        closeOr(() => {
          setPending("min");
          router.replace(href("min"), { scroll: false });
        }),
      [closeOr, href, router],
    ),
  };
}
