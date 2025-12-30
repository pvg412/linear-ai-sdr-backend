import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { websocketPlugin } from "./plugins/websocket";
import { loadEnv } from "./config/env";
import { registerAuthRoutes } from "./modules/auth/auth.controller";
import { createAuthGuard } from "./modules/auth/auth.guard";
import { AuthService } from "./modules/auth/services/auth.service";
import { registerChatRoutes } from "./modules/chat/chat.controller";
import { registerLeadRoutes } from "./modules/lead/lead.controller";
import { registerLeadDirectoryRoutes } from "./modules/lead-directory/lead-directory.controller";

export async function buildServer() {
	const env = loadEnv();

	const app = Fastify({
		logger: true,
	});

	await app.register(websocketPlugin);
	await app.register(cors, {
		origin: env.NODE_ENV === "production" ? [env.FRONTEND_URL] : true,
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: ["Authorization", "Content-Type"],
		// credentials: true,
		maxAge: 86400,
	});

	// Swagger should not be exposed in production
	if (env.NODE_ENV !== "production") {
		await app.register(swagger, {
			openapi: {
				info: { title: "AI SDR API", version: "1.0.0" },
				components: {
					securitySchemes: {
						bearerAuth: {
							type: "http",
							scheme: "bearer",
							bearerFormat: "JWT",
						},
					},
				},
			},
		});
		await app.register(swaggerUi, {
			routePrefix: "/docs",
		});
	}

	// Auth routes first (login stays public)
	registerAuthRoutes(app, env);

	// Ensure at least one admin exists (via env in prod, optional in dev)
	const authService = new AuthService();
	await authService.ensureInitialAdmin(env, app.log);

	// Protect everything else
	app.addHook("onRequest", createAuthGuard(env));

	registerChatRoutes(app);
	registerLeadRoutes(app);
	registerLeadDirectoryRoutes(app);

	return { app, env };
}
