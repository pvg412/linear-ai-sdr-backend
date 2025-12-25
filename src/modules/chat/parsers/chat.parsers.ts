import { z } from "zod";
import { LeadProvider, LeadSearchKind } from "@prisma/client";
import { UserFacingError } from "@/infra/userFacingError";

export const CHAT_PARSER_IDS = ["PARSER_A", "PARSER_B"] as const;
export type ChatParserId = (typeof CHAT_PARSER_IDS)[number];
export const ChatParserIdSchema = z.enum(CHAT_PARSER_IDS);

export type ChatParserPublicInfo = {
	id: ChatParserId;
	label: string;
};

type ChatParserConfig = ChatParserPublicInfo & {
	provider: LeadProvider;
	allowedKinds: LeadSearchKind[]; // validate (parser + kind) compatibility
};

function mustLeadProvider(v: string): LeadProvider {
	const ok = (Object.values(LeadProvider) as string[]).includes(v);
	if (!ok) {
		throw new Error(
			`[chatParsers] Invalid LeadProvider in mapping: "${v}". ` +
				`Allowed: ${(Object.values(LeadProvider) as string[]).join(", ")}`
		);
	}
	return v as LeadProvider;
}

function mustAllowedKinds(v: LeadSearchKind[]): LeadSearchKind[] {
	const allowed = new Set(Object.values(LeadSearchKind) as string[]);
	for (const k of v) {
		if (!allowed.has(k)) {
			throw new Error(
				`[chatParsers] Invalid LeadSearchKind in mapping: "${String(k)}".`
			);
		}
	}
	return v;
}

/**
 * Public parsers (frontend knows ONLY these).
 * Internally we map them to a provider, and validate requested kind is supported.
 */
export const CHAT_PARSERS: ChatParserConfig[] = [
	{
		id: "PARSER_A",
		label: "Parser A",
		provider: mustLeadProvider("SCRAPER_CITY"),
		allowedKinds: mustAllowedKinds([LeadSearchKind.LEAD_DB]),
	},
	{
		id: "PARSER_B",
		label: "Parser B",
		provider: mustLeadProvider("SEARCH_LEADS"),
		allowedKinds: mustAllowedKinds([LeadSearchKind.LEAD_DB]),
	},
];

const BY_ID = new Map<ChatParserId, ChatParserConfig>(
	CHAT_PARSERS.map((p) => [p.id, p])
);

const BY_PROVIDER = new Map<LeadProvider, ChatParserConfig>();
for (const p of CHAT_PARSERS) {
	// First wins; keep deterministic if someone accidentally duplicates
	if (!BY_PROVIDER.has(p.provider)) BY_PROVIDER.set(p.provider, p);
}

export function listChatParsers(): ChatParserPublicInfo[] {
	return CHAT_PARSERS.map(({ id, label }) => ({ id, label }));
}

export function resolveInternalFromParserId(input: unknown): {
	parser: ChatParserId;
	parserLabel: string;
	provider: LeadProvider;
	allowedKinds: LeadSearchKind[];
} {
	const parsed = ChatParserIdSchema.safeParse(input);
	if (!parsed.success) {
		throw new UserFacingError({
			code: "CHAT_PARSER_UNKNOWN",
			userMessage: "Unknown parser. Please re-select parser in UI.",
			debugMessage: `Unknown parser: ${String(input)}`,
		});
	}

	const cfg = BY_ID.get(parsed.data);
	if (!cfg) {
		throw new UserFacingError({
			code: "CHAT_PARSER_NOT_CONFIGURED",
			userMessage: "Parser is not configured on server.",
			debugMessage: `Parser ${parsed.data} not found in CHAT_PARSERS`,
		});
	}

	return {
		parser: cfg.id,
		parserLabel: cfg.label,
		provider: cfg.provider,
		allowedKinds: cfg.allowedKinds,
	};
}

export function resolveParserIdFromProvider(
	provider: LeadProvider | null | undefined
): ChatParserId | null {
	if (!provider) return null;
	return BY_PROVIDER.get(provider)?.id ?? null;
}

export function resolveParserLabelFromProvider(
	provider: LeadProvider | null | undefined
): string | null {
	if (!provider) return null;
	return BY_PROVIDER.get(provider)?.label ?? null;
}

// -------------------------
// Sanitizers (OUTGOING ONLY)
// -------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asLeadProvider(v: unknown): LeadProvider | null {
	if (typeof v !== "string") return null;
	return (Object.values(LeadProvider) as string[]).includes(v)
		? (v as LeadProvider)
		: null;
}

/**
 * Removes internal provider from payload and replaces with parser/parserLabel.
 * Keeps kind as-is (public).
 */
export function sanitizePayloadToPublic(payload: unknown): unknown {
	if (!isRecord(payload)) return payload;

	// already public
	if (typeof payload.parser === "string") return payload;

	const provider = asLeadProvider(payload.provider);
	if (!provider) return payload;

	const parser = resolveParserIdFromProvider(provider);
	const parserLabel = resolveParserLabelFromProvider(provider);

	if (!parser) {
		// Do NOT leak provider if mapping missing
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { provider: _p, ...rest } = payload;
		return rest;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { provider: _p, ...rest } = payload;

	return {
		...rest,
		parser,
		...(parserLabel ? { parserLabel } : {}),
	};
}

/**
 * Thread: replace defaultProvider -> defaultParser.
 * Keep defaultKind public.
 */
export function sanitizeThreadToPublic<T extends UnknownRecord>(
	thread: T
): UnknownRecord {
	const provider = asLeadProvider(thread.defaultProvider);
	const defaultParser = provider ? resolveParserIdFromProvider(provider) : null;
	const defaultParserLabel = provider
		? resolveParserLabelFromProvider(provider)
		: null;

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { defaultProvider: _dp, ...rest } = thread;

	return {
		...rest,
		defaultParser,
		...(defaultParserLabel ? { defaultParserLabel } : {}),
	};
}

export function sanitizeMessageToPublic<T extends UnknownRecord>(
	msg: T
): UnknownRecord {
	if (!("payload" in msg)) return msg;
	return {
		...msg,
		payload: sanitizePayloadToPublic((msg as UnknownRecord).payload),
	};
}
