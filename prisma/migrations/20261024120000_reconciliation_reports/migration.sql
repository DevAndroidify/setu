-- CreateTable
CREATE TABLE "control"."reconciliation_reports" (
    "run_id" UUID NOT NULL,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_reports_pkey" PRIMARY KEY ("run_id")
);

-- AddForeignKey
ALTER TABLE "control"."reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "control"."runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

