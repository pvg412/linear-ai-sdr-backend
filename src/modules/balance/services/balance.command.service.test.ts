import { describe, it, expect, vi, beforeEach } from "vitest";

import { UserFacingError } from "@/infra/userFacingError";
import { BalanceCommandService, centsToDollars } from "./balance.command.service";
import type { BalanceRepository } from "../persistence/balance.repository";

// ── centsToDollars helper ────────────────────────────────────────────────────

describe("centsToDollars", () => {
  it("formats zero correctly", () => {
    expect(centsToDollars(0)).toBe("0.00");
  });

  it("formats whole dollars", () => {
    expect(centsToDollars(1000)).toBe("10.00");
  });

  it("formats cents with rounding", () => {
    expect(centsToDollars(1250)).toBe("12.50");
    expect(centsToDollars(99)).toBe("0.99");
    expect(centsToDollars(1)).toBe("0.01");
  });
});

// ── BalanceCommandService ────────────────────────────────────────────────────

describe("BalanceCommandService", () => {
  let service: BalanceCommandService;
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

    // Inject mock repository
    service = new BalanceCommandService(mockRepo as unknown as BalanceRepository);
  });

  // ── adjustBalance: validation ──────────────────────────────────────────────

  it("throws BAD_REQUEST when amountCents is zero", async () => {
    await expect(
      service.adjustBalance({ userId: "u1", amountCents: 0, reason: "top-up", performedById: "admin" }),
    ).rejects.toThrow(UserFacingError);

    await expect(
      service.adjustBalance({ userId: "u1", amountCents: 0, reason: "top-up", performedById: "admin" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws BAD_REQUEST when amountCents is not an integer", async () => {
    await expect(
      service.adjustBalance({ userId: "u1", amountCents: 1.5, reason: "top-up", performedById: "admin" }),
    ).rejects.toThrow(UserFacingError);
  });

  it("throws BAD_REQUEST when reason is empty string", async () => {
    await expect(
      service.adjustBalance({ userId: "u1", amountCents: 100, reason: "   ", performedById: "admin" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── adjustBalance: success ─────────────────────────────────────────────────

  it("delegates to repository and returns formatted result on credit", async () => {
    mockRepo.adjustBalance.mockResolvedValue({ balanceCents: 1500, auditLogId: "log-1" });

    const result = await service.adjustBalance({
      userId: "u1",
      amountCents: 500,
      reason: "Manual top-up",
      performedById: "admin-1",
    });

    expect(mockRepo.adjustBalance).toHaveBeenCalledWith("u1", 500, "Manual top-up", "admin-1");
    expect(result).toEqual({
      balanceCents: 1500,
      auditLogId: "log-1",
      balanceDollars: "15.00",
    });
  });

  it("delegates to repository and returns formatted result on debit", async () => {
    mockRepo.adjustBalance.mockResolvedValue({ balanceCents: 200, auditLogId: "log-2" });

    const result = await service.adjustBalance({
      userId: "u1",
      amountCents: -300,
      reason: "Service charge",
      performedById: "admin-1",
    });

    expect(result.balanceDollars).toBe("2.00");
  });

  it("trims whitespace from reason before passing to repository", async () => {
    mockRepo.adjustBalance.mockResolvedValue({ balanceCents: 100, auditLogId: "log-3" });

    await service.adjustBalance({
      userId: "u1",
      amountCents: 100,
      reason: "  some reason  ",
      performedById: "admin-1",
    });

    expect(mockRepo.adjustBalance).toHaveBeenCalledWith("u1", 100, "some reason", "admin-1");
  });

  // ── adjustBalance: propagates repository errors ────────────────────────────

  it("propagates NOT_FOUND from repository when user does not exist", async () => {
    mockRepo.adjustBalance.mockRejectedValue(
      new UserFacingError({ code: "NOT_FOUND", userMessage: "User not found." }),
    );

    await expect(
      service.adjustBalance({ userId: "nonexistent", amountCents: 100, reason: "top-up", performedById: "admin" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propagates BAD_REQUEST from repository when balance would go negative", async () => {
    mockRepo.adjustBalance.mockRejectedValue(
      new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "Insufficient balance: the adjustment would result in a negative balance.",
      }),
    );

    await expect(
      service.adjustBalance({ userId: "u1", amountCents: -99999, reason: "over-debit", performedById: "admin" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
