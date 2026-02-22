import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { authPlugin } from "./plugins/auth";
import { sendError } from "./lib/errors";
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

    request.log.error({ err: error }, "Unhandled API error");
    return sendError(reply, 500, "INTERNAL_ERROR", "Unexpected server error");
  });

  return app;
}
