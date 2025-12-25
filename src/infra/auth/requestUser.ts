import type { FastifyRequest } from "fastify";

import { UserFacingError } from "@/infra/userFacingError";

export type RequestUserInfo = {
	id: string;
	email?: string;
	role: string;
};

export function requireRequestUser(req: FastifyRequest): RequestUserInfo {
	const user = req.user;

	if (
		user &&
		typeof user.id === "string" &&
		user.id.length > 0 &&
		typeof user.role === "string" &&
		user.role.length > 0
	) {
		return {
			id: user.id,
			email: user.email,
			role: user.role,
		};
	}

	throw new UserFacingError({
		code: "UNAUTHORIZED",
		userMessage: "Unauthorized.",
	});
}

export function requireRequestUserId(req: FastifyRequest): string {
	return requireRequestUser(req).id;
}
