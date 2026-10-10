import { drive, isMock, mockId, sheets, withRetry } from "@/google/client";

/**
 * The premade "<Client> — Credentials" Google Sheet of a client kit (ADR 0014). The content is a pure spec (unit
 * tested); `createCredentialsSheet` writes it with the Drive API (created straight inside the kit's Credentials
 * folder) and one Sheets batchUpdate + one values write. GOOGLE_MOCK returns a deterministic id and logs the spec.
 */
export const KIT_HEADERS = ["Platform", "Login URL", "Username / email", "Password", "Way", "2FA code goes to", "Notes"] as const;
export const KIT_WAYS = ["Email & password", "Sign in with Google", "Sign in with Microsoft", "Sign in with Apple", "Sign in with Facebook", "Phone OTP", "Other"] as const;
export const GUIDE_TAB = "How to fill";
export const MAIN_TAB = "Credentials";

export type KitSheetSpec = {
  title: string;
  description: string;
  note: string;
  headers: readonly string[];
  ways: readonly string[];
  examples: string[][];
  guide: string[][];
};

export function credentialsSheetSpec(clientName: string, company: string): KitSheetSpec {
  return {
    title: `${clientName} — Credentials`,
    description: `Logins ${company} needs to run your accounts. One row per platform; see the "${GUIDE_TAB}" tab before you fill it.`,
    note: `Please read the "${GUIDE_TAB}" tab first. One row per platform; grey rows are examples you can overwrite.`,
    headers: KIT_HEADERS,
    ways: KIT_WAYS,
    examples: [
      ["Instagram (example)", "https://www.instagram.com", "yourbrand.official", "", "Sign in with Facebook", "+91 98XXX XXX01 (owner's phone)", "Business account linked to the brand's Facebook page"],
      ["Google Ads (example)", "https://ads.google.com", "marketing@yourbrand.com", "", "Sign in with Google", "marketing@yourbrand.com", "Or add us as Admin on the account instead"],
      ["Website admin (example)", "https://yourbrand.com/wp-admin", "admin@yourbrand.com", "Example-Passw0rd!", "Email & password", "Not enabled", "WordPress dashboard"],
    ],
    guide: [
      [`How to fill the ${MAIN_TAB} tab`],
      [""],
      ["1. Use one row per platform or tool (Instagram, Facebook page, Google Ads, website, domain, email marketing, …)."],
      ["2. Platform: the name of the service. Login URL: the page where you sign in."],
      ["3. Username / email: the login name, phone number or email you use to sign in."],
      ["4. Way: how you sign in — pick from the list (Email & password, Sign in with Google, Microsoft, Apple, Facebook, Phone OTP, Other)."],
      ["5. If Way is \"Sign in with Google\" (or Microsoft / Apple / Facebook), write that account's email and leave Password blank."],
      ["6. Password: only for \"Email & password\". If you prefer, add us as a user / admin on the platform instead and write that in Notes."],
      ["7. 2FA code goes to: the phone number or email that receives one-time codes, so we know whom to ask when a code is needed."],
      ["8. Never put bank details, card numbers, UPI PINs or OTPs in this sheet."],
      ["9. The grey rows are examples — overwrite or delete them."],
      [`10. Questions? Reply to the email or WhatsApp from ${company} and we will help.`],
    ],
  };
}

/** Mock-mode log of created sheets (tests check the spec and folder). */
export const mockSheetLog: { id: string; parentId: string; spec: KitSheetSpec }[] = [];

const MAIN_ID = 0;
const GUIDE_ID = 1001;
const rgb = (v: number) => ({ red: v, green: v, blue: v });

/** Creates the sheet inside `parentId` (the kit's Credentials folder) and returns its id. */
export async function createCredentialsSheet(parentId: string, spec: KitSheetSpec): Promise<string> {
  if (isMock()) {
    const id = mockId("sheet", `${parentId}/${spec.title}`);
    mockSheetLog.push({ id, parentId, spec });
    return id;
  }
  const file = await withRetry(() =>
    drive().files.create({
      requestBody: { name: spec.title, mimeType: "application/vnd.google-apps.spreadsheet", parents: [parentId], description: spec.description },
      fields: "id",
      supportsAllDrives: true,
    }),
  );
  const spreadsheetId = file.data.id!;
  const meta = await withRetry(() => sheets().spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId))" }));
  const mainId = meta.data.sheets?.[0]?.properties?.sheetId ?? MAIN_ID;
  const cols = spec.headers.length;
  const wayCol = spec.headers.indexOf("Way");
  await withRetry(() =>
    sheets().spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { updateSheetProperties: { properties: { sheetId: mainId, title: MAIN_TAB, gridProperties: { frozenRowCount: 1 } }, fields: "title,gridProperties.frozenRowCount" } },
          { addSheet: { properties: { sheetId: GUIDE_ID, title: GUIDE_TAB } } },
          { repeatCell: { range: { sheetId: mainId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: rgb(0.93) } }, fields: "userEnteredFormat(textFormat,backgroundColor)" } },
          { repeatCell: { range: { sheetId: mainId, startRowIndex: 1, endRowIndex: 1 + spec.examples.length, startColumnIndex: 0, endColumnIndex: cols }, cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColor: rgb(0.55) } } }, fields: "userEnteredFormat.textFormat" } },
          {
            setDataValidation: {
              range: { sheetId: mainId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: wayCol, endColumnIndex: wayCol + 1 },
              rule: { condition: { type: "ONE_OF_LIST", values: spec.ways.map((w) => ({ userEnteredValue: w })) }, strict: true, showCustomUi: true },
            },
          },
          { updateCells: { start: { sheetId: mainId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: [{ note: spec.note }] }], fields: "note" } },
          { updateDimensionProperties: { range: { sheetId: mainId, dimension: "COLUMNS", startIndex: 0, endIndex: cols }, properties: { pixelSize: 190 }, fields: "pixelSize" } },
          { repeatCell: { range: { sheetId: GUIDE_ID, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } }, fields: "userEnteredFormat.textFormat" } },
          { updateDimensionProperties: { range: { sheetId: GUIDE_ID, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 760 }, fields: "pixelSize" } },
        ],
      },
    }),
  );
  await withRetry(() =>
    sheets().spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: `'${MAIN_TAB}'!A1`, values: [[...spec.headers], ...spec.examples] },
          { range: `'${GUIDE_TAB}'!A1`, values: spec.guide },
        ],
      },
    }),
  );
  return spreadsheetId;
}

export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
