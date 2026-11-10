/**
 * Google Meet REST API v2 (ADR 0015): open the task's Meet space to anyone with the link, switch on Gemini
 * "Take notes for me" (+ auto transcripts), lock the space when the task is deleted, and list the notes / transcript
 * Docs a conference produced. Every call is best-effort: a Workspace edition without Gemini, a missing
 * domain-wide-delegation scope or an API refusal becomes a warning, never a failed task.
 *
 * GOOGLE_MOCK=true simulates all of it in memory (see `mockMeet`).
 */
import { google, type meet_v2 } from "googleapis";
import { getMeetJwt, isMock, mockId, withRetry } from "@/google/client";

export type MeetArtifactKind = "SMART_NOTES" | "TRANSCRIPT";
export type MeetArtifact = { kind: MeetArtifactKind; conferenceRecord: string; docId: string; docUrl: string };
export type MeetConfigResult = { spaceName: string | null; accessType: string | null; smartNotes: boolean; transcription: boolean; warnings: string[] };

const meet = () => google.meet({ version: "v2", auth: getMeetJwt() });

/** "https://meet.google.com/abc-mnop-xyz?authuser=0" → "abc-mnop-xyz"; null when it isn't a Meet link. */
export function meetingCodeFromLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = /^https?:\/\/meet\.google\.com\/([a-z0-9]+(?:-[a-z0-9]+)+)(?:[/?#]|$)/i.exec(link.trim());
  return m ? m[1]!.toLowerCase() : null;
}

export const docUrl = (docId: string) => `https://docs.google.com/document/d/${docId}/edit`;

/** Short, log-friendly reason from a googleapis error. */
export function googleReason(e: unknown): string {
  const err = e as { code?: number; message?: string; response?: { status?: number } };
  const code = err.code ?? err.response?.status;
  return `${code ? `${code} ` : ""}${(err.message ?? String(e)).slice(0, 160)}`;
}

/** The space config the app wants on every task's Meet (ADR 0015). */
export const OPEN_WITH_NOTES: meet_v2.Schema$SpaceConfig = {
  accessType: "OPEN",
  artifactConfig: {
    smartNotesConfig: { autoSmartNotesGeneration: "ON" },
    transcriptionConfig: { autoTranscriptionGeneration: "ON" },
  },
};
const MASK_ACCESS = "config.accessType";
const MASK_NOTES = "config.artifactConfig.smartNotesConfig.autoSmartNotesGeneration";
const MASK_TRANSCRIPT = "config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration";

// ---------- mock (GOOGLE_MOCK) ----------
type MockSpace = { name: string; code: string; accessType: string; smartNotes: boolean; transcription: boolean; ended: number };
/** In-memory Meet used in GOOGLE_MOCK mode; tests may inspect or reset it. */
export const mockMeet = {
  spaces: new Map<string, MockSpace>(),
  reset() {
    this.spaces.clear();
  },
};
function mockSpace(code: string): MockSpace {
  const name = `spaces/${mockId("sp", code)}`;
  let s = mockMeet.spaces.get(name);
  if (!s) {
    s = { name, code, accessType: "TRUSTED", smartNotes: false, transcription: false, ended: 0 };
    mockMeet.spaces.set(name, s);
  }
  return s;
}

/**
 * Looks the space up by meeting code (`spaces/{meetingCode}` alias) and patches it: accessType OPEN (anyone with the
 * link joins without knocking), Gemini notes ON and transcripts ON. If the artifact settings are refused (no Gemini
 * in the edition, or not allowed for this organiser) it retries with access only and reports the warning.
 */
export async function configureTaskSpace(meetLink: string): Promise<MeetConfigResult> {
  const code = meetingCodeFromLink(meetLink);
  if (!code) return { spaceName: null, accessType: null, smartNotes: false, transcription: false, warnings: [`Not a Google Meet link: ${meetLink}`] };
  if (isMock()) {
    const s = mockSpace(code);
    Object.assign(s, { accessType: "OPEN", smartNotes: true, transcription: true });
    return { spaceName: s.name, accessType: s.accessType, smartNotes: true, transcription: true, warnings: [] };
  }
  const warnings: string[] = [];
  let space: meet_v2.Schema$Space;
  try {
    space = (await withRetry(() => meet().spaces.get({ name: `spaces/${code}` }))).data;
  } catch (e) {
    return { spaceName: null, accessType: null, smartNotes: false, transcription: false, warnings: [`Meet space lookup failed (${googleReason(e)})`] };
  }
  const name = space.name!;
  const attempts: { mask: string[]; config: meet_v2.Schema$SpaceConfig; label: string }[] = [
    { mask: [MASK_ACCESS, MASK_NOTES, MASK_TRANSCRIPT], config: OPEN_WITH_NOTES, label: "open + Gemini notes + transcript" },
    { mask: [MASK_ACCESS, MASK_NOTES], config: { accessType: "OPEN", artifactConfig: { smartNotesConfig: { autoSmartNotesGeneration: "ON" } } }, label: "open + Gemini notes" },
    { mask: [MASK_ACCESS], config: { accessType: "OPEN" }, label: "open" },
  ];
  for (const a of attempts) {
    try {
      const res = await withRetry(() => meet().spaces.patch({ name, updateMask: a.mask.join(","), requestBody: { config: a.config } }));
      const cfg = res.data.config ?? {};
      return {
        spaceName: name,
        accessType: cfg.accessType ?? null,
        smartNotes: cfg.artifactConfig?.smartNotesConfig?.autoSmartNotesGeneration === "ON",
        transcription: cfg.artifactConfig?.transcriptionConfig?.autoTranscriptionGeneration === "ON",
        warnings,
      };
    } catch (e) {
      warnings.push(`Meet config "${a.label}" refused (${googleReason(e)})`);
    }
  }
  return { spaceName: name, accessType: space.config?.accessType ?? null, smartNotes: false, transcription: false, warnings };
}

/**
 * Google can't delete a Meet link, so on task delete the space is made unusable: the active conference (if any) is
 * ended and access is set to RESTRICTED (only invitees of the — deleted — Calendar event could get in). Returns warnings.
 */
export async function lockTaskSpace(spaceNameOrLink: string): Promise<string[]> {
  const code = spaceNameOrLink.startsWith("spaces/") ? null : meetingCodeFromLink(spaceNameOrLink);
  const name = spaceNameOrLink.startsWith("spaces/") ? spaceNameOrLink : code ? `spaces/${code}` : null;
  if (!name) return [];
  if (isMock()) {
    const s = mockMeet.spaces.get(name) ?? (code ? mockSpace(code) : undefined);
    if (s) Object.assign(s, { accessType: "RESTRICTED", ended: s.ended + 1 });
    return [];
  }
  const warnings: string[] = [];
  try {
    await withRetry(() => meet().spaces.endActiveConference({ name, requestBody: {} }), 2);
  } catch (e) {
    const status = (e as { code?: number }).code;
    if (status !== 400 && status !== 404 && status !== 412) warnings.push(`Meet: could not end the call (${googleReason(e)})`); // 400/412 = no active call
  }
  try {
    await withRetry(() => meet().spaces.patch({ name, updateMask: MASK_ACCESS, requestBody: { config: { accessType: "RESTRICTED" } } }));
  } catch (e) {
    warnings.push(`Meet: could not restrict the link (${googleReason(e)})`);
  }
  return warnings;
}

/**
 * Gemini notes + transcript Docs of every conference held in the space (only Docs that are ready: FILE_GENERATED).
 * Mock: one notes Doc per space once the meeting's end (`mockMeetingEnd`) has passed.
 */
export async function listMeetArtifacts(spaceName: string, opts: { mockMeetingEnd?: Date | null; now?: Date } = {}): Promise<MeetArtifact[]> {
  if (isMock()) {
    const end = opts.mockMeetingEnd;
    if (!end || end > (opts.now ?? new Date())) return [];
    const record = `conferenceRecords/${mockId("cr", spaceName)}`;
    const docId = mockId("doc", `${spaceName}/notes`);
    return [{ kind: "SMART_NOTES", conferenceRecord: record, docId, docUrl: docUrl(docId) }];
  }
  const out: MeetArtifact[] = [];
  const records: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() => meet().conferenceRecords.list({ filter: `space.name = "${spaceName}"`, pageSize: 25, pageToken }));
    for (const r of res.data.conferenceRecords ?? []) if (r.name && r.endTime) records.push(r.name); // ended calls only
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && records.length < 100);
  for (const record of records) {
    const notes = await withRetry(() => meet().conferenceRecords.smartNotes.list({ parent: record, pageSize: 25 }));
    for (const n of notes.data.smartNotes ?? []) {
      const id = n.docsDestination?.document;
      if (id && n.state === "FILE_GENERATED") out.push({ kind: "SMART_NOTES", conferenceRecord: record, docId: id, docUrl: docUrl(id) });
    }
    const transcripts = await withRetry(() => meet().conferenceRecords.transcripts.list({ parent: record, pageSize: 25 }));
    for (const t of transcripts.data.transcripts ?? []) {
      const id = t.docsDestination?.document;
      if (id && t.state === "FILE_GENERATED") out.push({ kind: "TRANSCRIPT", conferenceRecord: record, docId: id, docUrl: docUrl(id) });
    }
  }
  return out;
}
