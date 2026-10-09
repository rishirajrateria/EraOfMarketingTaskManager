-- CreateEnum
CREATE TYPE "RepeatFrequency" AS ENUM ('DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "RecurrenceRule" ADD COLUMN     "anchorDate" TEXT,
ADD COLUMN     "endAfterCount" INTEGER,
ADD COLUMN     "monthDay" INTEGER,
ADD COLUMN     "nthWeek" INTEGER,
ADD COLUMN     "nthWeekday" INTEGER,
ADD COLUMN     "repeatFreq" "RepeatFrequency",
ADD COLUMN     "yearDay" INTEGER,
ADD COLUMN     "yearMonth" INTEGER;

