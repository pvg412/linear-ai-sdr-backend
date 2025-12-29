import { Prisma } from "@prisma/client";

export type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  child?: (bindings: Record<string, unknown>) => LoggerLike;
};

function two(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTimestamp(d: Date): string {
  // Local time, human readable: YYYY-MM-DD HH:mm:ss
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(
    d.getHours(),
  )}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

const consoleLogger: LoggerLike = {
	info: (obj: unknown, msg?: string) =>
		console.log(`[${formatTimestamp(new Date())}] ${msg ?? ""}`.trim(), obj),
	debug: (obj: unknown, msg?: string) =>
		console.debug(`[${formatTimestamp(new Date())}] ${msg ?? ""}`.trim(), obj),
	warn: (obj: unknown, msg?: string) =>
		console.warn(`[${formatTimestamp(new Date())}] ${msg ?? ""}`.trim(), obj),
	error: (obj: unknown, msg?: string) =>
		console.error(`[${formatTimestamp(new Date())}] ${msg ?? ""}`.trim(), obj),
	child: () => consoleLogger,
};
export function nowNs(): bigint {
  return process.hrtime.bigint();
}

export function msSince(startNs: bigint): number {
  const diff = process.hrtime.bigint() - startNs;
  return Number(diff) / 1e6;
}

export function safePreview(input: string, maxLen = 120): string {
  const oneLine = input.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen)}…`;
}

export function ensureLogger(log?: LoggerLike): LoggerLike {
	return log ?? consoleLogger;
}

export function isP2002Unique(e: unknown): e is Prisma.PrismaClientKnownRequestError {
	return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export function uniqueTarget(e: Prisma.PrismaClientKnownRequestError): string[] {
	const t = (e.meta as { target?: unknown } | undefined)?.target;
	if (Array.isArray(t)) return t.map(String);
	if (typeof t === "string") return [t];
	return [];
}

export function hasAnyDefined(obj: Record<string, unknown>): boolean {
	for (const v of Object.values(obj)) {
		if (v !== undefined) return true;
	}
	return false;
}