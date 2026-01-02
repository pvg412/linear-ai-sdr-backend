// src/infra/ai-grpc-client.ts
import * as grpc from "@grpc/grpc-js";
import { randomUUID } from "crypto";

import { loadEnv } from "@/config/env";

import type {
  ChatStreamEvent,
  ChatStreamRequest,
  DeleteLeadDocumentsRequest,
  DeleteLeadDocumentsResponse,
  ParseLeadSearchPromptRequest,
  ParseLeadSearchPromptResponse,
  PingResponse,
  UpsertLeadDocumentsRequest,
  UpsertLeadDocumentsResponse,
} from "../generated/aisdr/v1/ai_sdr";
import { AiSdrServiceClient as AiSdrServiceClientConstructor } from "../generated/aisdr/v1/ai_sdr";
import type { AiSdrServiceClient } from "../generated/aisdr/v1/ai_sdr";
import { Empty } from "../generated/google/protobuf/empty";

const env = loadEnv();

/** Minimal logger contract */
export interface LoggerLike {
  debug?: (msg: string, meta?: Record<string, unknown>) => void;
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
}

export type UnaryTimeouts = Partial<{
  pingMs: number;
  parseMs: number;
  upsertMs: number;
  deleteMs: number;
}>;

export interface AiGrpcClientOptions {
  /** e.g. "127.0.0.1:50051" */
  address: string;

  /** plaintext by default (dev). */
  insecure?: boolean;

  /** Default unary deadlines (ms). */
  timeouts?: UnaryTimeouts;

  /** Extra grpc channel options if needed. */
  channelOptions?: grpc.ChannelOptions;

  /** Optional logger */
  logger?: LoggerLike;
}

export interface ChatStreamOptions {
  /** Attach abort signal to cancel gRPC call. */
  signal?: AbortSignal;

  /** Optional deadline for stream. Usually omit (no deadline). */
  deadlineMs?: number;

  /** Optional extra metadata. */
  metadata?: grpc.Metadata;
}

type RequestWithRequestId = { requestId?: string };

function withRequestId<T extends RequestWithRequestId>(req: T): T & { requestId: string } {
  const rid = typeof req.requestId === "string" ? req.requestId.trim() : "";
  if (rid.length > 0) return { ...req, requestId: rid };
  return { ...req, requestId: randomUUID() };
}

function deadlineFromNow(timeoutMs: number): grpc.Deadline | undefined {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined;
  return Date.now() + timeoutMs;
}

function isServiceError(err: unknown): err is grpc.ServiceError {
  if (typeof err !== "object" || err === null) return false;
  const rec = err as Record<string, unknown>;
  return typeof rec.code === "number" && typeof rec.details === "string";
}

function formatGrpcError(err: unknown): string {
  if (!isServiceError(err)) {
    if (err instanceof Error) return err.message;
    return String(err);
  }
  const codeName = grpc.status[err.code] ?? String(err.code);
  return `gRPC ${codeName}: ${err.details || err.message}`;
}

export class AiGrpcClient {
  private readonly client: AiSdrServiceClient;
  private readonly logger?: LoggerLike;

  private readonly timeouts: Required<UnaryTimeouts>;

  constructor(opts: AiGrpcClientOptions) {
    this.logger = opts.logger;

    this.timeouts = {
      pingMs: opts.timeouts?.pingMs ?? 1500,
      parseMs: opts.timeouts?.parseMs ?? 20_000,
      upsertMs: opts.timeouts?.upsertMs ?? 60_000,
      deleteMs: opts.timeouts?.deleteMs ?? 60_000,
    };

    const insecure = opts.insecure ?? true;
    const creds = insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();

    // Match Python server defaults (50MB)
    const defaultChannelOptions: grpc.ChannelOptions = {
      "grpc.keepalive_time_ms": 30_000,
      "grpc.keepalive_timeout_ms": 10_000,
      "grpc.max_receive_message_length": 50 * 1024 * 1024,
      "grpc.max_send_message_length": 50 * 1024 * 1024,
    };

    // gRPC client "options" are effectively channel options + a few client-only fields
    const clientOptions: grpc.ClientOptions = {
      ...defaultChannelOptions,
      ...(opts.channelOptions ?? {}),
    };

    this.client = new AiSdrServiceClientConstructor(opts.address, creds, clientOptions);
  }

  static fromEnv(logger?: LoggerLike): AiGrpcClient {
    const address = (env.AI_GRPC_ADDRESS || "127.0.0.1:50051").trim();
    const insecure = String(env.AI_GRPC_INSECURE ?? "true").toLowerCase() !== "false";

    return new AiGrpcClient({ address, insecure, logger });
  }

  waitForReady(timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      this.client.waitForReady(deadline, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close(): void {
    this.client.close();
  }

  // -------------------------
  // Unary calls
  // -------------------------

  private unary<TReq, TRes>(
    methodName: string,
    call: (
      req: TReq,
      metadata: grpc.Metadata,
      options: grpc.CallOptions,
      callback: grpc.requestCallback<TRes>,
    ) => grpc.ClientUnaryCall,
    request: TReq,
    timeoutMs: number,
    metadata?: grpc.Metadata,
  ): Promise<TRes> {
    const md = metadata ?? new grpc.Metadata();
    const deadline = deadlineFromNow(timeoutMs);

    const options: grpc.CallOptions = {};
    if (deadline) options.deadline = deadline;

    return new Promise<TRes>((resolve, reject) => {
      call(request, md, options, (err, resp) => {
        if (err) {
          const msg = formatGrpcError(err);
          this.logger?.warn?.("ai.grpc.unary_error", { methodName, msg });
          reject(err);
          return;
        }
        if (resp === undefined) {
          reject(new Error(`ai.grpc.${methodName}: empty response`));
          return;
        }
        resolve(resp);
      });
    });
  }

  ping(): Promise<PingResponse> {
    const req = Empty.create();
    return this.unary(
      "ping",
      (r, md, opt, cb) => this.client.ping(r, md, opt, cb),
      req,
      this.timeouts.pingMs,
    );
  }

  parseLeadSearchPrompt(req: ParseLeadSearchPromptRequest): Promise<ParseLeadSearchPromptResponse> {
    const normalized = withRequestId(req);
    return this.unary(
      "parseLeadSearchPrompt",
      (r, md, opt, cb) => this.client.parseLeadSearchPrompt(r, md, opt, cb),
      normalized,
      this.timeouts.parseMs,
    );
  }

  upsertLeadDocuments(req: UpsertLeadDocumentsRequest): Promise<UpsertLeadDocumentsResponse> {
    const normalized = withRequestId(req);
    return this.unary(
      "upsertLeadDocuments",
      (r, md, opt, cb) => this.client.upsertLeadDocuments(r, md, opt, cb),
      normalized,
      this.timeouts.upsertMs,
    );
  }

  deleteLeadDocuments(req: DeleteLeadDocumentsRequest): Promise<DeleteLeadDocumentsResponse> {
    const normalized = withRequestId(req);
    return this.unary(
      "deleteLeadDocuments",
      (r, md, opt, cb) => this.client.deleteLeadDocuments(r, md, opt, cb),
      normalized,
      this.timeouts.deleteMs,
    );
  }

  // -------------------------
  // Server streaming: ChatStream
  // -------------------------

  chatStreamCall(req: ChatStreamRequest, opts?: ChatStreamOptions): grpc.ClientReadableStream<ChatStreamEvent> {
    const normalized = withRequestId(req);
    const md = opts?.metadata ?? new grpc.Metadata();

    const callOpts: grpc.CallOptions = {};
    if (opts?.deadlineMs && opts.deadlineMs > 0) {
      callOpts.deadline = Date.now() + opts.deadlineMs;
    }

    const stream = this.client.chatStream(normalized, md, callOpts);

    if (opts?.signal) {
      const onAbort = () => stream.cancel();

      if (opts.signal.aborted) {
        stream.cancel();
      } else {
        opts.signal.addEventListener("abort", onAbort, { once: true });

        const cleanup = () => opts.signal?.removeEventListener("abort", onAbort);
        stream.on("end", cleanup);
        stream.on("error", cleanup);
      }
    }

    return stream;
  }

  async *chatStream(req: ChatStreamRequest, opts?: ChatStreamOptions): AsyncIterable<ChatStreamEvent> {
    const stream = this.chatStreamCall(req, opts);

    const queue: ChatStreamEvent[] = [];
    let done = false;
    // `unknown | null` collapses to `unknown`; we keep `null` as an explicit sentinel.
    let streamError: unknown = null;

    let wake: (() => void) | null = null;
    const notify = () => {
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
    };

    const onData = (ev: ChatStreamEvent) => {
      queue.push(ev);
      notify();
    };

    const onEnd = () => {
      done = true;
      notify();
    };

    const onError = (err: unknown) => {
      streamError = err;
      done = true;
      notify();
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);

    try {
      while (!done || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        const item = queue.shift();
        if (item) yield item;
      }

      if (streamError) {
        const msg = formatGrpcError(streamError);
        this.logger?.warn?.("ai.grpc.stream_error", { msg });
        if (streamError instanceof Error) throw streamError;
        throw new Error(msg);
      }
    } finally {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      // Safety: if consumer stops early, cancel stream to avoid leaks
      stream.cancel();
    }
  }
}
