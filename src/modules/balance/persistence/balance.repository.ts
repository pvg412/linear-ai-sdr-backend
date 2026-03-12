import { injectable } from "inversify";
import type { PrismaClient, UserRole } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";

export type ResolvedUser = {
  id: string;
  email: string;
  role: UserRole;
  balanceCents: number;
};

export type BalanceAdjustResult = {
  balanceCents: number;
  auditLogId: string;
};

export type BalanceAuditEntry = {
  id: string;
  createdAt: Date;
  userId: string;
  amountCents: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  performedBy: string;
};

@injectable()
export class BalanceRepository {
  private readonly prisma: PrismaClient = getPrisma();

  /**
   * Atomically adjusts the user's balance and records an audit log entry
   * within a single database transaction.
   *
   * Uses a raw UPDATE with a conditional WHERE clause so that the balance
   * can only decrease to zero — the DB CHECK constraint is a second layer
   * of protection, but we detect the failure here to return a clear error.
   *
   * IMPORTANT: this is the ONLY place in the codebase that may write to
   * the User.balanceCents column.
   */
  async adjustBalance(
    userId: string,
    amountCents: number,
    reason: string,
    performedBy: string,
  ): Promise<BalanceAdjustResult> {
    return this.prisma.$transaction(async (tx) => {
      // Step 1: fetch current balance inside the transaction (row lock via UPDATE)
      const rows = await tx.$queryRaw<{ balanceCents: number }[]>`
        SELECT "balanceCents"
        FROM "User"
        WHERE "id" = ${userId}
        FOR UPDATE
      `;

      if (rows.length === 0) {
        throw new UserFacingError({
          code: "NOT_FOUND",
          userMessage: "User not found.",
        });
      }

      const balanceBefore = rows[0].balanceCents;
      const balanceAfter = balanceBefore + amountCents;

      if (balanceAfter < 0) {
        throw new UserFacingError({
          code: "BAD_REQUEST",
          userMessage: "Insufficient balance: the adjustment would result in a negative balance.",
          details: {
            balanceCents: balanceBefore,
            amountCents,
            balanceAfter,
          },
        });
      }

      // Step 2: apply the balance change atomically
      await tx.$executeRaw`
        UPDATE "User"
        SET "balanceCents" = ${balanceAfter},
            "updatedAt"    = NOW()
        WHERE "id" = ${userId}
      `;

      // Step 3: write the immutable audit log entry
      const auditLog = await tx.balanceAuditLog.create({
        data: {
          userId,
          amountCents,
          balanceBefore,
          balanceAfter,
          reason,
          performedBy,
        },
        select: { id: true },
      });

      return { balanceCents: balanceAfter, auditLogId: auditLog.id };
    });
  }

  /**
   * Resolves a user by UUID/cuid or by email address.
   * Detection: if the identifier contains "@" it is treated as email, otherwise as id.
   */
  async resolveUserByIdentifier(identifier: string): Promise<ResolvedUser> {
    const isEmail = identifier.includes("@");
    const user = await this.prisma.user.findFirst({
      where: isEmail ? { email: identifier } : { id: identifier },
      select: { id: true, email: true, role: true, balanceCents: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found.",
      });
    }

    return { id: user.id, email: user.email, role: user.role, balanceCents: user.balanceCents };
  }

  async getUserBalance(userId: string): Promise<{ balanceCents: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balanceCents: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found.",
      });
    }

    return { balanceCents: user.balanceCents };
  }

  async getAuditLog(
    userId: string,
    page: number,
    perPage: number,
  ): Promise<{ entries: BalanceAuditEntry[]; total: number }> {
    const where = { userId };

    const [entries, total] = await Promise.all([
      this.prisma.balanceAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.balanceAuditLog.count({ where }),
    ]);

    return { entries, total };
  }
}
