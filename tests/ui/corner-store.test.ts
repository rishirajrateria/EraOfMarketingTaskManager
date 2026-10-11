import { describe, it, expect } from "vitest";
import { cornerStore } from "@/components/shell/corner-store";

/** One close control (ADR 0016 addendum, prototype `cornerMode` / `cornerTap`): the corner × closes the latest open thing. */
describe("corner close store", () => {
  it("is a + while nothing is open", () => {
    expect(cornerStore.hasOpen()).toBe(false);
    expect(cornerStore.closeTop()).toBe(false);
  });

  it("closes the most recently opened thing first (a sheet over a form page, then the page)", () => {
    const closed: string[] = [];
    const offPage = cornerStore.push(() => closed.push("page"));
    const offSheet = cornerStore.push(() => closed.push("sheet"));
    expect(cornerStore.hasOpen()).toBe(true);
    expect(cornerStore.closeTop()).toBe(true);
    expect(closed).toEqual(["sheet"]);
    offSheet(); // the sheet unmounts / closes itself
    expect(cornerStore.closeTop()).toBe(true);
    expect(closed).toEqual(["sheet", "page"]);
    offPage();
    expect(cornerStore.hasOpen()).toBe(false);
  });

  it("unregisters exactly once and tells subscribers when the corner flips", () => {
    let calls = 0;
    const unsub = cornerStore.subscribe(() => calls++);
    const off = cornerStore.push(() => undefined);
    off();
    off(); // a second removal is a no-op
    expect(calls).toBe(2);
    unsub();
    cornerStore.push(() => undefined)();
    expect(calls).toBe(2);
  });

  it("closeAll closes everything, newest first (Home tapped on the home screen)", () => {
    const closed: string[] = [];
    const offs = ["page", "sheet", "sub-sheet"].map((n) => cornerStore.push(() => closed.push(n)));
    cornerStore.closeAll();
    expect(closed).toEqual(["sub-sheet", "sheet", "page"]);
    offs.forEach((off) => off());
    expect(cornerStore.hasOpen()).toBe(false);
  });

  it("removing an older entry keeps the newer one on top", () => {
    const closed: string[] = [];
    const offA = cornerStore.push(() => closed.push("a"));
    const offB = cornerStore.push(() => closed.push("b"));
    offA();
    cornerStore.closeTop();
    expect(closed).toEqual(["b"]);
    offB();
    expect(cornerStore.hasOpen()).toBe(false);
  });
});
