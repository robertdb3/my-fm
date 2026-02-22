import type { FastifyPluginAsync } from "fastify";
import { UpdateUserSettingsSchema } from "@music-cable-box/shared";
import { sendError } from "../lib/errors";
import { getOrCreateUserSettings, updateUserSettings } from "../services/user-settings-service";

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/api/settings",
    {
      preHandler: app.authenticate
    },
    async (request) => {
      const settings = await getOrCreateUserSettings(request.appUser.id);
      return { settings };
    }
  );

  app.patch(
    "/api/settings",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const parsed = UpdateUserSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid settings payload", parsed.error.flatten());
      }

      const settings = await updateUserSettings(request.appUser.id, parsed.data);
      return { settings };
    }
  );
};
