import { UserRole } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";
import type { Env } from "@/config/env";
import { hashPassword, verifyPassword } from "../auth.password";
import { signJwt, type JwtPayload } from "../auth.jwt";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  companyName?: string | null;
  customInstructions?: string | null;
  /** Balance in cents. Always present; use balanceDollars for display. */
  balanceCents: number;
  /** Balance formatted as a dollar string, e.g. "12.50". */
  balanceDollars: string;
};

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export class AuthService {
  private readonly prisma = getPrisma();

  async login(
    email: string,
    password: string,
    env: Env,
  ): Promise<{
    accessToken: string;
    expiresInSeconds: number;
    user: AuthUser;
  }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UserFacingError({ userMessage: "Invalid credentials", code: "INVALID_CREDENTIALS" });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw new UserFacingError({ userMessage: "Invalid credentials", code: "INVALID_CREDENTIALS" });
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = env.AUTH_TOKEN_TTL_SECONDS;
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      iat: now,
      exp: now + expiresInSeconds,
    };

    const accessToken = signJwt(payload, env.AUTH_JWT_SECRET);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken,
      expiresInSeconds,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        balanceCents: user.balanceCents,
        balanceDollars: centsToDollars(user.balanceCents),
      },
    };
  }

  async devRegisterAdmin(
    email: string,
    password: string,
  ): Promise<{ user: AuthUser }> {
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.ADMIN,
      },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        balanceCents: user.balanceCents,
        balanceDollars: centsToDollars(user.balanceCents),
      },
    };
  }

  async createSaleManager(
    email: string,
    password: string,
    companyId?: string,
  ): Promise<{ user: AuthUser }> {
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.SALE_MANAGER,
        ...(companyId && { companyId }),
      },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        balanceCents: user.balanceCents,
        balanceDollars: centsToDollars(user.balanceCents),
      },
    };
  }

  async createCompany(
    email: string,
    password: string,
    companyName: string,
  ): Promise<{ user: AuthUser }> {
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.COMPANY,
        companyName,
      },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        companyName: user.companyName,
        balanceCents: user.balanceCents,
        balanceDollars: centsToDollars(user.balanceCents),
      },
    };
  }

  async listCompanySaleManagers(
    companyId: string,
    page: number,
    perPage: number,
  ): Promise<{
    users: Array<{ id: string; email: string; role: string; createdAt: unknown }>;
    total: number;
    page: number;
    perPage: number;
  }> {
    const where = {
      companyId,
      role: UserRole.SALE_MANAGER,
      isActive: true,
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, role: true, createdAt: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: users as Array<{
        id: string;
        email: string;
        role: string;
        createdAt: unknown;
      }>,
      total,
      page,
      perPage,
    };
  }

  async removeCompanySaleManager(
    companyId: string,
    saleManagerId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: saleManagerId },
    });

    if (
      !user ||
      user.companyId !== companyId ||
      user.role !== UserRole.SALE_MANAGER
    ) {
      throw new UserFacingError({ userMessage: "Sale manager not found in this company", code: "SALE_MANAGER_NOT_FOUND" });
    }

    await this.prisma.user.update({
      where: { id: saleManagerId },
      data: { isActive: false },
    });
  }

  async ensureInitialAdmin(
    env: Env,
    log?: {
      info: (o: unknown, m?: string) => void;
      warn: (o: unknown, m?: string) => void;
      error: (o: unknown, m?: string) => void;
    },
  ): Promise<void> {
    const count = await this.prisma.user.count();
    if (count > 0) return;

    const email = env.AUTH_INITIAL_ADMIN_EMAIL;
    const password = env.AUTH_INITIAL_ADMIN_PASSWORD;

    if (!email || !password) {
      if (env.NODE_ENV === "production") {
        throw new UserFacingError({
          userMessage: "Initial admin configuration is missing",
          code: "MISSING_INITIAL_ADMIN",
          debugMessage: "No users exist. Set AUTH_INITIAL_ADMIN_EMAIL and AUTH_INITIAL_ADMIN_PASSWORD to bootstrap the first admin.",
        });
      }
      log?.warn(
        { hasEmail: Boolean(email), hasPassword: Boolean(password) },
        "Auth: no users exist and no initial admin env provided; login will be impossible until a user is created",
      );
      return;
    }

    const passwordHash = await hashPassword(password);
    await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.ADMIN,
      },
    });

    log?.info({ email }, "Auth: initial admin user created");
  }

  async getUserInfo(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      throw new UserFacingError({ userMessage: "User not found", code: "USER_NOT_FOUND" });
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      companyName: user.companyName,
      customInstructions: user.customInstructions,
      balanceCents: user.balanceCents,
      balanceDollars: centsToDollars(user.balanceCents),
    };
  }

  async updateCompanyName(
    userId: string,
    companyName: string,
  ): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      throw new UserFacingError({ userMessage: "User not found", code: "USER_NOT_FOUND" });
    }

    if (user.role !== UserRole.COMPANY) {
      throw new UserFacingError({ userMessage: "Only company users can update company name", code: "FORBIDDEN" });
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { companyName },
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      companyName: updatedUser.companyName,
      balanceCents: updatedUser.balanceCents,
      balanceDollars: centsToDollars(updatedUser.balanceCents),
    };
  }

  async updateCustomInstructions(
    userId: string,
    customInstructions: string | null,
  ): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      throw new UserFacingError({ userMessage: "User not found", code: "USER_NOT_FOUND" });
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { customInstructions },
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      companyName: updatedUser.companyName,
      customInstructions: updatedUser.customInstructions,
      balanceCents: updatedUser.balanceCents,
      balanceDollars: centsToDollars(updatedUser.balanceCents),
    };
  }

  async getCustomInstructions(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { customInstructions: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UserFacingError({ userMessage: "User not found", code: "USER_NOT_FOUND" });
    }

    return user.customInstructions;
  }
}
