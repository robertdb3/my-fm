import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { authPlugin } from "./plugins/auth";
import { sendError, type ErrorCode } from "./lib/errors";
import { authRoutes } from "./routes/auth";
import { feedbackRoutes } from "./routes/feedback";
import { healthRoutes } from "./routes/health";
import { historyRoutes } from "./routes/history";
import { libraryRoutes } from "./routes/library";
import { navidromeRoutes } from "./routes/navidrome";
import { stationRoutes } from "./routes/stations";
import "./types";

export function createApp() {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: {
                translateTime: "HH:MM:ss",
                ignore: "pid,hostname"
              }
            }
          : undefined
    }
  });

  app.register(cors, {
    origin: true,
    credentials: true
  });

  app.register(authPlugin);
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(navidromeRoutes);
  app.register(libraryRoutes);
  app.register(stationRoutes);
  app.register(feedbackRoutes);
  app.register(historyRoutes);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return sendError(reply, 400, "BAD_REQUEST", "Validation failed", error.flatten());
    }

    const maybeFastifyError =
      typeof error === "object" && error !== null
        ? (error as {
            statusCode?: unknown;
            message?: unknown;
          })
        : undefined;
    const statusCode =
      typeof maybeFastifyError?.statusCode === "number" ? maybeFastifyError.statusCode : NaN;
    const message =
      typeof maybeFastifyError?.message === "string"
        ? maybeFastifyError.message
        : error instanceof Error
          ? error.message
          : "Request failed";

    if (Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 500) {
      const codeByStatus: Record<number, ErrorCode> = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT"
      };

      return sendError(
        reply,
        statusCode,
        codeByStatus[statusCode] ?? "BAD_REQUEST",
        message
      );
    }

    request.log.error({ err: error }, "Unhandled API error");
    return sendError(reply, 500, "INTERNAL_ERROR", "Unexpected server error");
  });

  return app;
}
