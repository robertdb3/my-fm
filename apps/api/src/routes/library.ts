import type { FastifyPluginAsync } from "fastify";
import { NavidromeImportInputSchema } from "@music-cable-box/shared";
import { sendError } from "../lib/errors";
import { ImportAlreadyRunningError, importLibraryForUser } from "../services/library-import-service";

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/library/import",
    async (request, reply) => {
      const parsed = NavidromeImportInputSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid import options", parsed.error.flatten());
      }

      try {
        const result = await importLibraryForUser(request.appUser.id, parsed.data);
        return {
          ok: true,
          result
        };
      } catch (error) {
        if (error instanceof ImportAlreadyRunningError) {
          return sendError(
            reply,
            409,
            "CONFLICT",
            "A library import is already running. Wait for it to finish before starting another."
          );
        }

        return sendError(reply, 400, "BAD_REQUEST", "Library import failed", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );
};
