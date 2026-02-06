import { UserRole } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import type { Env } from "@/config/env";
import { hashPassword, verifyPassword } from "../auth.password";
import { signJwt, type JwtPayload } from "../auth.jwt";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};

type DbUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  companyId: string | null;
};

type PrismaWithUser = {
  user: {
    findUnique: (args: {
      where: { email: string } | { id: string };
    }) => Promise<DbUser | null>;
    findUniqueOrThrow?: unknown;
    create: (args: {
      data: {
        email: string;
        passwordHash: string;
        role: UserRole;
        companyId?: string;
      };
    }) => Promise<DbUser>;
    update: (args: {
      where: { id: string };
      data: Partial<{ lastLoginAt: Date; isActive: boolean }>;
    }) => Promise<DbUser>;
    count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
    findMany: (args: {
      where: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: Record<string, string>;
      select?: Record<string, boolean>;
    }) => Promise<Array<Record<string, unknown>>>;
  };
};

export class AuthService {
  private readonly prisma = getPrisma() as unknown as PrismaWithUser;

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
      throw new Error("Invalid credentials");
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw new Error("Invalid credentials");
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
      user: { id: user.id, email: user.email, role: user.role },
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
    return { user: { id: user.id, email: user.email, role: user.role } };
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
    return { user: { id: user.id, email: user.email, role: user.role } };
  }

  async createCompany(
    email: string,
    password: string,
  ): Promise<{ user: AuthUser }> {
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.COMPANY,
      },
    });
    return { user: { id: user.id, email: user.email, role: user.role } };
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
      throw new Error("Sale manager not found in this company");
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
        throw new Error(
          "No users exist. Set AUTH_INITIAL_ADMIN_EMAIL and AUTH_INITIAL_ADMIN_PASSWORD to bootstrap the first admin.",
        );
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
}
