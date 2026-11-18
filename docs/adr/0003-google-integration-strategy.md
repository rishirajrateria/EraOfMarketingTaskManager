# ADR 0003 — Google Workspace integration strategy

Status: accepted · Date: 2026-09-10

## Decision
- **Sign-in** uses the user's own OAuth consent (NextAuth Google) and requests incremental scopes so the app can act
  as the user in the browser (opening Drive/Meet/Chat links, future user-context calls).
- **Server-side automation** (Drive folders, Calendar + Meet, Chat spaces, Gmail, Sheets) uses a **service account
  with domain-wide delegation** impersonating `GOOGLE_IMPERSONATE_USER`, so resources are company-owned and not tied
  to whoever created the task (SPEC §1).
- Every wrapper in `src/google/*` is **idempotent** (lookup-before-create, `requestId` on Calendar/Chat) and wrapped in
  `withRetry()` (exponential backoff on 429/5xx).
- `GOOGLE_MOCK=true` short-circuits all wrappers with deterministic fake ids so development, CI and the seed work
  without credentials. Attachments and PDFs are additionally stored in Postgres (`Bytes`) so files remain
  downloadable when Drive is mocked or unavailable.
- **Meet deactivation** on approval is implemented by ending the Calendar event now and removing its conference data
  (the Meet link stops admitting participants). The Chat space is kept until task deletion.
