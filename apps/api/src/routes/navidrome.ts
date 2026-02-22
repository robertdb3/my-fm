import type { FastifyPluginAsync } from "fastify";
import { NavidromeConnectionInputSchema } from "@music-cable-box/shared";
import { prisma } from "../db";
import { sendError } from "../lib/errors";
import { createSubsonicToken, generateSalt, normalizeBaseUrl } from "../lib/subsonic";
import { NavidromeClient } from "../services/navidrome-client";

export const navidromeRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/navidrome/test-connection",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const parsed = NavidromeConnectionInputSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendError(
          reply,
          400,
          "BAD_REQUEST",
          "Invalid Navidrome connection payload",
          parsed.error.flatten()
        );
      }

      const { baseUrl, username, password } = parsed.data;
      const salt = generateSalt();
      const token = createSubsonicToken(password, salt);

      const client = new NavidromeClient({
        baseUrl: normalizeBaseUrl(baseUrl),
        username,
        token,
        salt
      });

      try {
        await client.ping();
      } catch (error) {
        return sendError(reply, 400, "BAD_REQUEST", "Failed to connect to Navidrome", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }

      const account = await prisma.navidromeAccount.upsert({
        where: {
          userId: request.appUser.id
        },
        update: {
          baseUrl: normalizeBaseUrl(baseUrl),
          username,
          token,
          salt
        },
        create: {
          userId: request.appUser.id,
          baseUrl: normalizeBaseUrl(baseUrl),
          username,
          token,
          salt
        }
      });

      return {
        ok: true,
        account: {
          id: account.id,
          baseUrl: account.baseUrl,
          username: account.username,
          updatedAt: account.updatedAt
        },
        security: {
          message:
            "Stored Subsonic token+salt (derived from password). Plain password is not persisted in app storage."
        }
      };
    }
  );
};
