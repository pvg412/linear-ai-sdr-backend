import type { FastifyRequest } from "fastify";

import {
  sanitizeMessageToPublic,
  sanitizeThreadToPublic,
} from "../parsers/chat.parsers";
import type { ChatWsServerEvent } from "../schemas/chat.ws.schemas";
import { requireRequestUserId } from "@/infra/auth/requestUser";

/**
 * Minimal WS connection shape we rely on.
 */
export type ChatWsSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close" | "error", listener: (...args: unknown[]) => void): void;
};

export type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function extractWsSocket(conn: unknown): ChatWsSocket {
  const candidate = isRecord(conn) && "socket" in conn ? conn.socket : conn;

  if (!isRecord(candidate)) {
    const keys = isRecord(conn) ? Object.keys(conn) : [];
    throw new Error(`WS socket is not an object (connKeys=${keys.join(",")})`);
  }

  const send = candidate.send;
  const on = candidate.on;
  const close = candidate.close;
  const readyState = candidate.readyState;

  if (
    typeof send !== "function" ||
    typeof on !== "function" ||
    typeof close !== "function"
  ) {
    const keys = Object.keys(candidate);
    throw new Error(`WS socket has invalid shape (keys=${keys.join(",")})`);
  }

  if (typeof readyState !== "number") {
    throw new Error("WS socket readyState is not a number");
  }

  return candidate as unknown as ChatWsSocket;
}

function extractWsToken(req: FastifyRequest): string | null {
  // query token: ws://.../ws/chat/threads/:id?token=...
  const q = (req.query ?? {}) as Record<string, unknown>;
  const token = q["token"];
  if (typeof token === "string" && token.trim().length > 0) return token.trim();
  return null;
}

export async function ensureUserId(req: FastifyRequest): Promise<string> {
  const existing = req.user?.id;
  if (typeof existing === "string" && existing.length > 0) return existing;

  const token = extractWsToken(req);
  if (token) {
    // Fastify types treat headers as readonly-ish; at runtime it's mutable
    const headers = (req as unknown as { headers: Record<string, unknown> })
      .headers;
    if (typeof headers["authorization"] !== "string") {
      headers["authorization"] = `Bearer ${token}`;
    }
  }

  const jwtVerify = (req as unknown as { jwtVerify?: () => Promise<void> })
    .jwtVerify;
  if (typeof jwtVerify === "function") {
    await jwtVerify();
  }

  return requireRequestUserId(req);
}

export function wsSend(socket: ChatWsSocket, event: ChatWsServerEvent): void {
  try {
    socket.send(JSON.stringify(event));
  } catch {
    // ignore
  }
}

// Generic sanitizer for REST responses (threads/messages)
export function sanitizeAny(v: unknown): unknown {
  if (Array.isArray(v)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return v.map((x) => (isRecord(x) ? sanitizeThreadToPublic(x) : x));
  }
  if (!isRecord(v)) return v;

  // NEW: threads list
  if (Array.isArray(v.threads)) {
    return {
      ...v,
      threads: v.threads.map((x) =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        isRecord(x) ? sanitizeThreadToPublic(x) : x,
      ),
    };
  }

  // NEW: messages list
  if (Array.isArray(v.messages)) {
    return {
      ...v,
      messages: v.messages.map((x) =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        isRecord(x) ? sanitizeMessageToPublic(x) : x,
      ),
    };
  }

  // old "items" branches keep as-is (if you use it somewhere else)
  if (
    Array.isArray(v.items) &&
    v.items.length &&
    isRecord(v.items[0]) &&
    ("defaultProvider" in v.items[0] || "defaultParser" in v.items[0])
  ) {
    return {
      ...v,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      items: v.items.map((x) => (isRecord(x) ? sanitizeThreadToPublic(x) : x)),
    };
  }

  if (
    Array.isArray(v.items) &&
    v.items.length &&
    isRecord(v.items[0]) &&
    "payload" in v.items[0]
  ) {
    return {
      ...v,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      items: v.items.map((x) => (isRecord(x) ? sanitizeMessageToPublic(x) : x)),
    };
  }

  if ("defaultProvider" in v) return sanitizeThreadToPublic(v);

  return v;
}
