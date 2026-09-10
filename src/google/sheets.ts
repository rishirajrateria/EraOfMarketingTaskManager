import { isMock, sheets, withRetry } from "@/google/client";

export async function ensureSpreadsheet(title: string, existingId?: string): Promise<string> {
  if (existingId) return existingId;
  if (isMock()) return `mock_sheet_${title.toLowerCase()}`;
  const res = await withRetry(() => sheets().spreadsheets.create({ requestBody: { properties: { title } } }));
  return res.data.spreadsheetId!;
}

/** Replace the full contents of a tab (idempotent full sync). */
export async function writeTable(spreadsheetId: string, tab: string, rows: (string | number)[][]) {
  if (isMock()) return;
  const meta = await withRetry(() => sheets().spreadsheets.get({ spreadsheetId }));
  const has = meta.data.sheets?.some((s) => s.properties?.title === tab);
  if (!has) {
    await withRetry(() =>
      sheets().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } }),
    );
  }
  await withRetry(() => sheets().spreadsheets.values.clear({ spreadsheetId, range: `${tab}!A:Z` }));
  await withRetry(() =>
    sheets().spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    }),
  );
}

export async function readTable(spreadsheetId: string, tab: string): Promise<string[][]> {
  if (isMock()) return [];
  const res = await withRetry(() => sheets().spreadsheets.values.get({ spreadsheetId, range: `${tab}!A:Z` }));
  return (res.data.values ?? []) as string[][];
}

export async function shareSpreadsheet(spreadsheetId: string, email: string, role: "reader" | "writer") {
  const { shareWith } = await import("@/google/drive");
  await shareWith(spreadsheetId, [email], role);
}
