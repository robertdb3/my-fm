import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db";

export const historyRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/api/history",
    {
      preHandler: app.authenticate
    },
    async (request) => {
      const query = request.query as { stationId?: string; limit?: string };
      const parsedLimit = Number(query.limit ?? "50");
      const limit = Number.isFinite(parsedLimit) ? Math.min(200, Math.max(1, parsedLimit)) : 50;

      const events = await prisma.playEvent.findMany({
        where: {
          userId: request.appUser.id,
          ...(query.stationId ? { stationId: query.stationId } : {})
        },
        orderBy: {
          playedAt: "desc"
        },
        take: limit
      });

      const trackIds = Array.from(new Set(events.map((event) => event.navidromeSongId)));
      const tracks = await prisma.trackCache.findMany({
        where: {
          navidromeSongId: {
            in: trackIds.length > 0 ? trackIds : ["__none__"]
          }
        }
      });

      const trackById = new Map(tracks.map((track) => [track.navidromeSongId, track]));

      return {
        events: events.map((event) => ({
          ...event,
          track: trackById.get(event.navidromeSongId) ?? null
        }))
      };
    }
  );
};
