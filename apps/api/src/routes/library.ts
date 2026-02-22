import type { FastifyPluginAsync } from "fastify";
import { NavidromeImportInputSchema } from "@music-cable-box/shared";
import { sendError } from "../lib/errors";
import { importLibraryForUser } from "../services/library-import-service";

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/library/import",
    {
      preHandler: app.authenticate
    },
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
        return sendError(reply, 400, "BAD_REQUEST", "Library import failed", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );
};
