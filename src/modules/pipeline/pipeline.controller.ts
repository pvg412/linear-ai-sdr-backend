import type { FastifyInstance } from "fastify";

import { container } from "@/container";
import { requireRequestUserId } from "@/infra/auth/requestUser";
import { PIPELINE_TYPES } from "./pipeline.types";
import type { PipelineCommandService } from "./services/pipeline.command.service";
import type { PipelineQueryService } from "./services/pipeline.query.service";
import type { PipelineBroadcaster } from "./engine/pipeline.broadcaster";
import {
  StartPipelineBodySchema,
  PipelineRunParamsSchema,
  ListPipelineRunsQuerySchema,
} from "./schemas/pipeline.schemas";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

type RealtimeSocket = {
  readonly readyState: number;
  on(event: "close" | "error", listener: () => void): void;
  send(data: string): void;
};

function extractWsSocket(conn: unknown): RealtimeSocket {
  const c = conn as { socket?: RealtimeSocket };
  return c.socket ?? (conn as RealtimeSocket);
}

function wsSend(socket: RealtimeSocket, event: unknown): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(event));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/*  Route registration                                                */
/* ------------------------------------------------------------------ */

export function registerPipelineRoutes(app: FastifyInstance): void {
  const commandService = container.get<PipelineCommandService>(
    PIPELINE_TYPES.PipelineCommandService,
  );
  const queryService = container.get<PipelineQueryService>(
    PIPELINE_TYPES.PipelineQueryService,
  );
  const broadcaster = container.get<PipelineBroadcaster>(
    PIPELINE_TYPES.PipelineBroadcaster,
  );

  /* ---------------------------------------------------------------- */
  /*  POST /pipelines/runs — start a pipeline                        */
  /* ---------------------------------------------------------------- */

  app.post("/pipelines/runs", async (req, reply) => {
    const userId = requireRequestUserId(req);
    const body = StartPipelineBodySchema.parse(req.body);

    const result = await commandService.startPipeline(
      userId,
      body.pipelineKey,
      body.input,
    );

    reply.code(202);
    return result;
  });

  /* ---------------------------------------------------------------- */
  /*  GET /pipelines/runs/:id — get run details                */
  /* ---------------------------------------------------------------- */

  app.get("/pipelines/runs/:id", async (req) => {
    const userId = requireRequestUserId(req);
    const params = PipelineRunParamsSchema.parse(req.params);

    return queryService.getRun(userId, params.id);
  });

  /* ---------------------------------------------------------------- */
  /*  GET /pipelines/runs — list runs for current user         */
  /* ---------------------------------------------------------------- */

  app.get("/pipelines/runs", async (req) => {
    const userId = requireRequestUserId(req);
    const query = ListPipelineRunsQuerySchema.parse(req.query);

    return queryService.listRuns(userId, query);
  });

  /* ---------------------------------------------------------------- */
  /*  POST /pipelines/runs/:id/cancel — cancel a run                 */
  /* ---------------------------------------------------------------- */

  app.post("/pipelines/runs/:id/cancel", async (req, reply) => {
    const userId = requireRequestUserId(req);
    const params = PipelineRunParamsSchema.parse(req.params);

    await commandService.cancelPipeline(userId, params.id);

    reply.code(204);
  });

  /* ---------------------------------------------------------------- */
  /*  GET /pipelines/definitions — list available pipelines          */
  /* ---------------------------------------------------------------- */

  app.get("/pipelines/definitions", () => {
    return queryService.listDefinitions();
  });

  /* ---------------------------------------------------------------- */
  /*  WS /ws/pipelines/runs/:pipelineRunId — subscribe to events      */
  /* ---------------------------------------------------------------- */

  app.get(
    "/ws/pipelines/runs/:pipelineRunId",
    { websocket: true },
    async (conn, req) => {
      const socket = extractWsSocket(conn);
      let userId: string;

      try {
        userId = requireRequestUserId(req);
      } catch {
        wsSend(socket, {
          type: "error",
          payload: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
        return;
      }

      const pipelineRunId = (req.params as { pipelineRunId?: string })
        ?.pipelineRunId;
      if (!pipelineRunId) {
        wsSend(socket, {
          type: "error",
          payload: { code: "BAD_REQUEST", message: "Missing pipelineRunId" },
        });
        return;
      }

      /* Verify ownership */
      try {
        await queryService.getRun(userId, pipelineRunId);
      } catch {
        wsSend(socket, {
          type: "error",
          payload: { code: "FORBIDDEN", message: "Access denied" },
        });
        return;
      }

      /* Subscribe to pipeline events */
      broadcaster.subscribe(pipelineRunId, socket);

      wsSend(socket, {
        type: "pipeline.ready",
        pipelineRunId,
        serverTime: new Date().toISOString(),
      });
    },
  );
}
