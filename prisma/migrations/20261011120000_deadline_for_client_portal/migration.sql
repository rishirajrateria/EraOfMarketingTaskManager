-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "portalToken" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "deadlineOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forClient" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Client_portalToken_key" ON "Client"("portalToken");

