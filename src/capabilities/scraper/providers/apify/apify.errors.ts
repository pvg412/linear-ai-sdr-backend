import { ApifyApiError } from "apify-client";

import { UserFacingError } from "@/infra/userFacingError";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function formatApifyErrorDetails(err: ApifyApiError): UnknownRecord {
	return {
		statusCode: err.statusCode,
		type: err.type,
		clientMethod: err.clientMethod,
		path: err.path,
		attempt: err.attempt,
		data: err.data,
	};
}

export function wrapApifyError(e: unknown): void {
	if (!(e instanceof ApifyApiError)) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error("[ApifyScraper] error", msg);
		return;
	}

	console.error("[ApifyScraper] error response", formatApifyErrorDetails(e));

	const status = e.statusCode;
	const type = e.type;
	const providerMessage = e.message;

	if (status === 401 || status === 403) {
		throw new UserFacingError({
			code: "APIFY_UNAUTHORIZED",
			userMessage:
				"Apify rejected the request (invalid token).\n" +
				"Check APIFY_TOKEN in your environment.\n",
			debugMessage: providerMessage
				? `Apify auth error: ${providerMessage}`
				: undefined,
			details: { status, type },
		});
	}

	if (status === 400 || type === "invalid-input") {
		throw new UserFacingError({
			code: "APIFY_INVALID_INPUT",
			userMessage:
				"Apify rejected request (invalid input).\n" +
				"Check searchQuery, titles, and locations.\n",
			debugMessage: providerMessage
				? `Apify invalid-input: ${providerMessage}`
				: undefined,
			details: { status, type },
		});
	}

	if (status === 429) {
		throw new UserFacingError({
			code: "APIFY_RATE_LIMIT",
			userMessage:
				"Apify rate limit reached. Please retry later.\n" +
				"Consider lowering takePages or limit.\n",
			debugMessage: providerMessage
				? `Apify rate limited: ${providerMessage}`
				: undefined,
			details: { status, type },
		});
	}

	if (isRecord(e.data) && typeof e.data.message === "string") {
		throw new UserFacingError({
			code: "APIFY_ERROR",
			userMessage: "Apify request failed. Please try again later.",
			debugMessage: e.data.message,
			details: { status, type },
		});
	}

	throw new UserFacingError({
		code: "APIFY_ERROR",
		userMessage: "Apify request failed. Please try again later.",
		debugMessage: providerMessage || "ApifyApiError without message",
		details: { status, type },
	});
}
