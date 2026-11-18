import { beforeEach, describe, expect, it } from "vitest";
import { configureTaskSpace, docUrl, listMeetArtifacts, lockTaskSpace, meetingCodeFromLink, mockMeet } from "@/google/meet";
import { DWD_SCOPES, MEET_SCOPES, SA_SCOPES } from "@/google/client";
import { taskFolderName, taskFolderParent, MEETING_NOTES_FOLDER } from "@/google/task-folder";
import { workTaskPeople } from "@/server/tasks/task-people";
import { unfiledArtifacts } from "@/jobs/meeting-notes";
import { deleteItems } from "@/components/dashboard/DeleteTaskSheet";

describe("Meet REST API v2 helpers (ADR 0015, GOOGLE_MOCK)", () => {
  beforeEach(() => mockMeet.reset());

  it("meetingCodeFromLink", () => {
    expect(meetingCodeFromLink("https://meet.google.com/abc-mnop-xyz")).toBe("abc-mnop-xyz");
    expect(meetingCodeFromLink("https://meet.google.com/ABC-mnop-xyz?authuser=0")).toBe("abc-mnop-xyz");
    expect(meetingCodeFromLink("https://meet.google.com/abc-mock-1234/")).toBe("abc-mock-1234");
    expect(meetingCodeFromLink("https://example.com/abc-mnop-xyz")).toBeNull();
    expect(meetingCodeFromLink(null)).toBeNull();
    expect(docUrl("d1")).toBe("https://docs.google.com/document/d/d1/edit");
  });

  it("the Meet scopes are requested separately and listed for domain-wide delegation", () => {
    expect(MEET_SCOPES).toContain("https://www.googleapis.com/auth/meetings.space.created");
    expect(MEET_SCOPES).toContain("https://www.googleapis.com/auth/meetings.space.settings");
    expect(SA_SCOPES.some((s) => s.includes("meetings."))).toBe(false); // a missing delegation can't break Drive / Calendar
    expect(DWD_SCOPES).toEqual([...SA_SCOPES, ...MEET_SCOPES]);
  });

  it("configure → OPEN + Gemini notes + transcripts; delete → RESTRICTED and the call ended", async () => {
    const res = await configureTaskSpace("https://meet.google.com/abc-mnop-xyz");
    expect(res).toMatchObject({ accessType: "OPEN", smartNotes: true, transcription: true, warnings: [] });
    expect(res.spaceName).toMatch(/^spaces\//);
    expect(mockMeet.spaces.get(res.spaceName!)?.accessType).toBe("OPEN");
    expect(await lockTaskSpace(res.spaceName!)).toEqual([]);
    expect(mockMeet.spaces.get(res.spaceName!)).toMatchObject({ accessType: "RESTRICTED", ended: 1 });
    const bad = await configureTaskSpace("not a link");
    expect(bad.spaceName).toBeNull();
    expect(bad.warnings[0]).toMatch(/Not a Google Meet link/);
  });

  it("mock artifacts: one Gemini notes Doc once the meeting is over; filed docs are skipped", async () => {
    const now = new Date("2026-10-10T10:00:00Z");
    expect(await listMeetArtifacts("spaces/x", { mockMeetingEnd: new Date("2026-10-10T11:00:00Z"), now })).toEqual([]);
    const done = await listMeetArtifacts("spaces/x", { mockMeetingEnd: new Date("2026-10-10T09:00:00Z"), now });
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ kind: "SMART_NOTES" });
    expect(unfiledArtifacts(done, [])).toHaveLength(1);
    expect(unfiledArtifacts(done, [done[0]!.docId])).toEqual([]);
    expect(unfiledArtifacts([...done, ...done], [])).toHaveLength(1); // the same doc twice → filed once
  });
});

describe("task Drive folder naming (ADR 0015)", () => {
  it("named after the title; the short id suffix only when the name is taken", () => {
    expect(taskFolderName("Diwali reel", "ckabc123xyz789", false)).toBe("Diwali reel");
    expect(taskFolderName("Diwali reel", "ckabc123xyz789", true)).toBe("Diwali reel – xyz789");
    expect(taskFolderName("  Two   spaces ", "id", false)).toBe("Two spaces");
    expect(taskFolderName("", "id", false)).toBe("Untitled task");
    expect(taskFolderParent({ client: { name: "Repo" } })).toEqual(["Clients", "Repo"]);
    expect(MEETING_NOTES_FOLDER).toBe("Meeting notes");
  });
});

describe("workTaskPeople — Chat / Drive vs Calendar people (ADR 0015)", () => {
  const p = workTaskPeople({
    assignees: [{ email: "Sana@x.com", teamLeaderEmail: "karan@x.com" }],
    teamMembers: [
      { email: "karan@x.com", role: "TEAM_LEADER", active: true },
      { email: "sana@x.com", role: "EXECUTIVE", active: true },
      { email: "arjun@x.com", role: "EXECUTIVE", active: true },
      { email: "gone@x.com", role: "EXECUTIVE", active: false },
      { email: "boss@x.com", role: "ADMIN", active: true },
    ],
    teamLeaderEmails: ["karan@x.com"],
    creatorEmail: "admin@x.com",
    adminEmails: ["admin@x.com", "owner@x.com"],
  });
  it("Chat + Drive: assigned + Team Leader + every active executive of the team + creator; no outsiders", () => {
    expect(p.internal).toEqual(["sana@x.com", "karan@x.com", "arjun@x.com", "admin@x.com"]);
  });
  it("Calendar: assigned + Team Leader + creator + Admins (unassigned executives stay free)", () => {
    expect(p.calendar).toEqual(["sana@x.com", "karan@x.com", "admin@x.com", "owner@x.com"]);
  });
});

describe("delete sheet list (ADR 0015)", () => {
  it("lists what the task has, always ending with the task details", () => {
    const full = deleteItems({ type: "WORK", calendarEventId: "e", meetLink: "m", driveFolderUrl: "d", chatSpaceUrl: "c" });
    expect(full.map((i) => i.key)).toEqual(["calendar", "meet", "drive", "chat", "data"]);
    const meeting = deleteItems({ type: "MEETING", calendarEventId: "e", meetLink: "m", driveFolderUrl: "d", chatSpaceUrl: null });
    expect(meeting.map((i) => i.key)).toEqual(["calendar", "meet", "drive", "data"]);
  });
});
