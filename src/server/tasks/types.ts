import type { Priority, TaskStatus, TaskType } from "@prisma/client";
import type { RowColour } from "@/server/tasks/state";
import type { MeetingOptions } from "@/server/tasks/schema";
import type { ReviewField } from "@/server/tasks/review-fields";

/** Serialisable task row for the dashboard (SPEC §5.2). */
export type TaskRow = {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  colour: RowColour;
  overdue: boolean;
  important: boolean;
  priority: Priority;
  doubtRaised: boolean;
  doubtNote: string | null;
  reviewRequested: boolean;
  reviewNote: string | null;
  /** Pills with a review dot (ADR 0015): "date" | "time" | "mins". */
  reviewFields: ReviewField[];
  paused: boolean;
  recurring: boolean;
  /** "Every Fri · 10 times" (ADR 0010); null when not repeating. */
  repeatText?: string | null;
  selfAssigned: boolean;
  protected: boolean;
  client: { id: string; name: string };
  teams: { id: string; name: string; colour: string }[];
  assignees: { id: string; name: string; avatar: string | null }[];
  /** Admin's suggested executives when the task went to a Team Leader (ADR 0008). */
  preferredAssigneeIds: string[];
  tags: { id: string; name: string; colour: string }[];
  /** The task's work type (first tag), drives the "✓ specialist" marks. */
  workTypeId: string | null;
  allocatedMinutes: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  driveFolderUrl: string | null;
  meetLink: string | null;
  meetActive: boolean;
  /** The "Meeting notes" subfolder of the task's Drive folder (ADR 0015). */
  meetingNotesUrl: string | null;
  /** Gemini notes / transcripts filed into that folder by the meeting-notes job (ADR 0015). */
  meetingNotes: { id: string; kind: "SMART_NOTES" | "TRANSCRIPT"; url: string; createdAt: string }[];
  /** Meetings: external guests (ADR 0012); internal guests are the assignees. */
  guestEmails: string[];
  /** Meetings: Google Calendar options (ADR 0012); null for work tasks. */
  meetingOptions: MeetingOptions | null;
  chatSpaceUrl: string | null;
  calendarEventId: string | null;
  integrationError: string | null;
  finishRequestedAt: string | null;
  parentTaskId: string | null;
  childTaskId: string | null;
  attachments: { id: string; name: string; kind: string; url: string; durationSec: number | null }[];
  createdById: string;
  createdAt: string;
};

export type PillGroup = { key: string; label: string; items: { id: string; label: string; minutes: number; count?: number }[] };

export type DashboardData = {
  role: "ADMIN" | "TEAM_LEADER" | "EXECUTIVE";
  tasks: TaskRow[];
  row1: { id: string; label: string }[]; // Admin: teams; TL: executives; Exec: clients
  row2: { id: string; label: string }[]; // clients (Exec: work types)
  /** `teamIds` empty = legacy work type available to every team (ADR 0008). */
  workTypes: { id: string; name: string; colour: string; teamIds: string[] }[];
  /** `emails`: the client's addresses a meeting invites automatically (email + contact when it is one, ADR 0012). */
  clients: { id: string; name: string; emails?: string[] }[];
  teams: { id: string; name: string; colour: string }[];
  people: { id: string; name: string; role: string; teamId: string | null; teamLeaderId: string | null; specialityIds: string[] }[];
  me: { id: string; role: string; teamId: string | null };
  tz: string;
  /** yyyy-MM-dd of the user's next approved leave (drives the B4Leave pill filter). */
  nextLeaveKey: string | null;
};

/** Dashboard filter state persisted per user (SPEC §5.4). */
export type DashboardFilters = {
  colours: RowColour[];
  icons: ("paused" | "doubt" | "review" | "important" | "recurring" | "restarted")[];
  row1: string | null; // team / executive / client id
  row2: string | null; // client / work type id
  pill: string | null; // "team:<id>" | "person:<id>" | "client:<id>" | "date:today|tomorrow|b4leave|all"
  date: string | null; // yyyy-MM-dd
  quick: "asc" | "tomorrow" | "today" | null;
  completed: boolean;
  recurringOnly: boolean;
  pausedOnly: boolean;
};

export const DEFAULT_FILTERS: DashboardFilters = {
  colours: [],
  icons: [],
  row1: null,
  row2: null,
  pill: null,
  date: null,
  quick: null,
  completed: false,
  recurringOnly: false,
  pausedOnly: false,
};
