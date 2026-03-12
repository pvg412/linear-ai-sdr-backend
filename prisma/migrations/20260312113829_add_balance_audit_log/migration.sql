-- AlterTable
ALTER TABLE "User" ADD COLUMN     "balanceCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BalanceAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "performedBy" TEXT NOT NULL,

    CONSTRAINT "BalanceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceAuditLog_userId_idx" ON "BalanceAuditLog"("userId");

-- CreateIndex
CREATE INDEX "BalanceAuditLog_createdAt_idx" ON "BalanceAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "BalanceAuditLog" ADD CONSTRAINT "BalanceAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DB-level guard: balance can never go negative. This is enforced independently of application logic.
ALTER TABLE "User" ADD CONSTRAINT "user_balance_non_negative" CHECK ("balanceCents" >= 0);
