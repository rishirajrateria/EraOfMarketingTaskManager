-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "field" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "reviewFields" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- The old single review flag counts as a review of the time allotted (ADR 0015).
UPDATE "Task" SET "reviewFields" = ARRAY['mins'] WHERE "reviewRequested" = true AND cardinality("reviewFields") = 0;
UPDATE "Request" SET "field" = 'mins' WHERE "type" IN ('REVIEW', 'TIME_CHANGE') AND "field" IS NULL;
