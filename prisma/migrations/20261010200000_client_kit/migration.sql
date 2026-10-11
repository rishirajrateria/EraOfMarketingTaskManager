-- ADR 0014: client kit (Drive folders + credentials sheet) per client; kit root + subfolder names in settings.
ALTER TABLE "Client" ADD COLUMN "kitFolderId" TEXT,
ADD COLUMN "kitBrandId" TEXT,
ADD COLUMN "kitCredentialsId" TEXT,
ADD COLUMN "kitSheetId" TEXT,
ADD COLUMN "kitWorkId" TEXT,
ADD COLUMN "kitReportsId" TEXT,
ADD COLUMN "kitCreatedAt" TIMESTAMP(3),
ADD COLUMN "kitSharedWith" TEXT,
ADD COLUMN "kitSentAt" TIMESTAMP(3),
ADD COLUMN "kitSentVia" TEXT;

ALTER TABLE "CompanySettings" ADD COLUMN "clientKitRootId" TEXT,
ADD COLUMN "clientKitFolders" TEXT[] DEFAULT ARRAY['Brand kit', 'Credentials', 'Work', 'Reports']::TEXT[];
