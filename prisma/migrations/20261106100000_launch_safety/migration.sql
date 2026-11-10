-- ADR 0020: client-facing "Final work" folder on the kit; failed Google job notification + dismissal
ALTER TABLE "Client" ADD COLUMN "kitFinalId" TEXT;
ALTER TABLE "IntegrationJob" ADD COLUMN "failureNotifiedAt" TIMESTAMP(3),
ADD COLUMN "dismissedAt" TIMESTAMP(3);
