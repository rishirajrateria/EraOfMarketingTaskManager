-- ADR 0013: cache of the Finance root folder in the owner's Google Drive (parent of the YYYY-MM month folders).
CREATE TABLE "FinanceDriveRoot" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "folderId" TEXT NOT NULL,
    "ownerEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceDriveRoot_pkey" PRIMARY KEY ("id")
);
