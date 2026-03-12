import { describe, it, expect, vi, beforeEach } from "vitest";

import { UserFacingError } from "@/infra/userFacingError";
import { BalanceQueryService } from "./balance.query.service";
import type { BalanceRepository } from "../persistence/balance.repository";

describe("BalanceQueryService", () => {
  let service: BalanceQueryService;
  let mockRepo: {
    adjustBalance: ReturnType<typeof vi.fn>;
    getUserBalance: ReturnType<typeof vi.fn>;
    getAuditLog: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepo = {
      adjustBalance: vi.fn(),
      getUserBalance: vi.fn(),
      getAuditLog: vi.fn(),
    };

    service = new BalanceQueryService(mockRepo as unknown as BalanceRepository);
  });

  // ── getBalance ─────────────────────────────────────────────────────────────

  describe("getBalance", () => {
    it("returns balanceCents and formatted balanceDollars", async () => {
      mockRepo.getUserBalance.mockResolvedValue({ balanceCents: 4299 });

      const result = await service.getBalance("user-1");

      expect(result).toEqual({ balanceCents: 4299, balanceDollars: "42.99" });
    });

    it("returns 0.00 for a new user with zero balance", async () => {
      mockRepo.getUserBalance.mockResolvedValue({ balanceCents: 0 });

      const result = await service.getBalance("user-2");

      expect(result).toEqual({ balanceCents: 0, balanceDollars: "0.00" });
    });

    it("propagates NOT_FOUND when user does not exist", async () => {
      mockRepo.getUserBalance.mockRejectedValue(
        new UserFacingError({ code: "NOT_FOUND", userMessage: "User not found." }),
      );

      await expect(service.getBalance("ghost")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ── getAuditLog ────────────────────────────────────────────────────────────

  describe("getAuditLog", () => {
    it("enriches entries with formatted dollar amounts", async () => {
      const entry = {
        id: "log-1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        userId: "user-1",
        amountCents: 500,
        balanceBefore: 1000,
        balanceAfter: 1500,
        reason: "top-up",
        performedBy: "admin-1",
      };

      mockRepo.getAuditLog.mockResolvedValue({ entries: [entry], total: 1 });

      const result = await service.getAuditLog("user-1", 1, 20);

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
      expect(result.entries[0]).toMatchObject({
        amountDollars: "5.00",
        balanceBeforeDollars: "10.00",
        balanceAfterDollars: "15.00",
      });
    });

    it("returns empty entries and total 0 when no audit log exists", async () => {
      mockRepo.getAuditLog.mockResolvedValue({ entries: [], total: 0 });

      const result = await service.getAuditLog("user-1", 1, 20);

      expect(result.entries).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("passes page and perPage to the repository", async () => {
      mockRepo.getAuditLog.mockResolvedValue({ entries: [], total: 0 });

      await service.getAuditLog("user-1", 3, 50);

      expect(mockRepo.getAuditLog).toHaveBeenCalledWith("user-1", 3, 50);
    });
  });
});
