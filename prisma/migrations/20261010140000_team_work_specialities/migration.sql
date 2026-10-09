-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "preferredAssigneeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "_UserSpecialities" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserSpecialities_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TeamToWorkType" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TeamToWorkType_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_UserSpecialities_B_index" ON "_UserSpecialities"("B");

-- CreateIndex
CREATE INDEX "_TeamToWorkType_B_index" ON "_TeamToWorkType"("B");

-- AddForeignKey
ALTER TABLE "_UserSpecialities" ADD CONSTRAINT "_UserSpecialities_A_fkey" FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserSpecialities" ADD CONSTRAINT "_UserSpecialities_B_fkey" FOREIGN KEY ("B") REFERENCES "WorkType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeamToWorkType" ADD CONSTRAINT "_TeamToWorkType_A_fkey" FOREIGN KEY ("A") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeamToWorkType" ADD CONSTRAINT "_TeamToWorkType_B_fkey" FOREIGN KEY ("B") REFERENCES "WorkType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

