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

function getBearerTokenFromHeader(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;

  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;

  const t = token.trim();
  return t.length ? t : null;
}

/**
 * WS in browsers usually can't send Authorization header.
 * Allow token via query param ONLY for /ws/* routes:
 *   ws://host/ws/chat/threads/:threadId?token=JWT
 *
 * IMPORTANT: token in query can leak into access logs.
 * Prefer cookie-based auth later if this becomes production.
 */
function getTokenFromQuery(req: FastifyRequest): string | null {
  const url = req.url ?? "";
  const idx = url.indexOf("?");
  if (idx === -1) return null;

  const qs = url.slice(idx + 1);
  const params = new URLSearchParams(qs);
  const token = params.get("token") ?? params.get("access_token");
  const t = (token ?? "").trim();
  return t.length ? t : null;
}

function getTokenFromCookieHeader(req: FastifyRequest): string | null {
  // Optional fallback without @fastify/cookie
  const cookie = req.headers.cookie;
  if (!cookie) return null;

  // naive parse; good enough for JWT cookie
  const parts = cookie.split(";").map((x) => x.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;

    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();

    if (k === "access_token" || k === "jwt") {
      const t = decodeURIComponent(v);
      return t.length ? t : null;
    }
  }

  return null;
}

export function createAuthGuard(env: Env) {
  const prisma = getPrisma() as unknown as PrismaWithUser;

  return async function authGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Let CORS preflight pass through.
    if (request.method === "OPTIONS") return;

    const pathname = (request.url.split("?")[0] ?? request.url) || "";

    // Public routes
    if (pathname.startsWith("/docs")) return;
    if (pathname.startsWith("/auth/login")) return;

    if (env.NODE_ENV !== "production" && env.AUTH_ALLOW_DEV_REGISTER) {
      if (pathname.startsWith("/auth/dev-register")) return;
    }

    const isWsRoute = pathname.startsWith("/ws/");

    const token =
      getBearerTokenFromHeader(request) ??
      (isWsRoute ? getTokenFromQuery(request) : null) ??
      getTokenFromCookieHeader(request);

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
