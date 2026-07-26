-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT,
    "agent_name" TEXT,
    "action" TEXT NOT NULL,
    "customer_id" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_customer_id_idx" ON "audit_logs"("customer_id");
