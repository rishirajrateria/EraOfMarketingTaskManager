-- AlterTable: ADR 0004 — fixed expense category list, configurable half-day hours, Chat posting opt-in
ALTER TABLE "CompanySettings"
ADD COLUMN     "expenseCategories" TEXT[] DEFAULT ARRAY['Travel', 'Software', 'Office', 'Marketing', 'Salaries', 'Rent', 'Utilities', 'Other']::TEXT[],
ADD COLUMN     "halfDayMinutes" INTEGER NOT NULL DEFAULT 240,
ALTER COLUMN "notifyChatDefault" SET DEFAULT false;
