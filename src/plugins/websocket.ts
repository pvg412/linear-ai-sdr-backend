import fp from "fastify-plugin";
import websocket from "@fastify/websocket";

/**
 * Registers WebSocket support for Fastify.
 * Must be registered BEFORE WS routes.
 */
export const websocketPlugin = fp(async (app) => {
	await app.register(websocket, {
		options: {
			// keep payload sane; adjust if you send big JSON
			maxPayload: 1024 * 1024,
		},
	});
});
