import type { FastifyReply, FastifyRequest } from "fastify";

import type { Env } from "@/config/env";
import { getPrisma } from "@/infra/prisma";
import { verifyJwt } from "./auth.jwt";

export type RequestUser = {
  id: string;
  email: string;
  role: string;
};

type PrismaWithUser = {
  user: {
    findUnique: (args: {
      where: { id: string };
    }) => Promise<{ id: string; email: string; role: string; isActive: boolean } | null>;
  };
};

function getBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export function createAuthGuard(env: Env) {
  const prisma = getPrisma() as unknown as PrismaWithUser;

  return async function authGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Let CORS preflight pass through.
    if (request.method === "OPTIONS") return;

    const pathname = request.url.split("?")[0] ?? request.url;

    // Public routes
    if (pathname.startsWith("/docs")) return; // swagger-ui (html, json, static assets)
    if (pathname.startsWith("/auth/login")) return;
    if (env.NODE_ENV !== "production" && env.AUTH_ALLOW_DEV_REGISTER) {
      if (pathname.startsWith("/auth/dev-register")) return;
    }

    // Telegram webhook must stay public (Telegram servers won't send our JWT).
    if (pathname.startsWith("/telegram/webhook")) return;

    const token = getBearerToken(request);
    if (!token) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }

    try {
      const payload = verifyJwt(token, env.AUTH_JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.isActive) {
        reply.code(401).send({ message: "Unauthorized" });
        return;
      }

      request.user = {
        id: user.id,
        email: user.email,
        role: user.role,
      };
    } catch (e) {
      request.log.warn({ err: e }, "Auth failed");
      reply.code(401).send({ message: "Unauthorized" });
    }
  };
}

