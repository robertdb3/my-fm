import type { FastifyPluginAsync } from "fastify";
import { CreateStationSchema, StationRulesSchema, UpdateStationSchema } from "@music-cable-box/shared";
import { prisma } from "../db";
import { sendError } from "../lib/errors";
import {
  createStation,
  deleteStation,
  getStationById,
  listStations,
  updateStation
} from "../services/station-service";
import { advanceNextTrack, getStationPreviewCount, peekNextTracks } from "../services/station-generator";

export const stationRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/api/stations",
    {
      preHandler: app.authenticate
    },
    async (request) => {
      const stations = await listStations(request.appUser.id);
      return { stations };
    }
  );

  app.post(
    "/api/stations",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const parsed = CreateStationSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid station payload", parsed.error.flatten());
      }

      const station = await createStation(request.appUser.id, parsed.data);
      return reply.status(201).send({ station });
    }
  );

  app.get(
    "/api/stations/rule-options",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const query = request.query as {
        field?: string;
        q?: string;
        limit?: string;
      };

      const field = query.field;
      const q = query.q?.trim();
      const parsedLimit = Number(query.limit ?? "20");
      const limit = Number.isFinite(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 20;

      if (field !== "genre" && field !== "artist" && field !== "album") {
        return sendError(reply, 400, "BAD_REQUEST", "field must be one of: genre, artist, album");
      }

      if (field === "genre") {
        const rows = await prisma.trackCache.findMany({
          where: {
            genre: {
              not: null,
              ...(q ? { contains: q } : {})
            }
          },
          select: { genre: true },
          distinct: ["genre"],
          orderBy: { genre: "asc" },
          take: limit
        });

        return {
          options: rows.map((row) => row.genre).filter((value): value is string => Boolean(value))
        };
      }

      if (field === "artist") {
        const rows = await prisma.trackCache.findMany({
          where: {
            artist: {
              ...(q ? { contains: q } : {})
            }
          },
          select: { artist: true },
          distinct: ["artist"],
          orderBy: { artist: "asc" },
          take: limit
        });

        return {
          options: rows.map((row) => row.artist).filter((value): value is string => Boolean(value))
        };
      }

      const rows = await prisma.trackCache.findMany({
        where: {
          album: {
            not: null,
            ...(q ? { contains: q } : {})
          }
        },
        select: { album: true },
        distinct: ["album"],
        orderBy: { album: "asc" },
        take: limit
      });

      return {
        options: rows.map((row) => row.album).filter((value): value is string => Boolean(value))
      };
    }
  );

  app.get(
    "/api/stations/preview",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const query = request.query as { stationId?: string };

      if (!query.stationId) {
        return sendError(reply, 400, "BAD_REQUEST", "stationId is required");
      }

      const station = await getStationById(request.appUser.id, query.stationId);

      if (!station) {
        return sendError(reply, 404, "NOT_FOUND", "Station not found");
      }

      const matchingTrackCount = await getStationPreviewCount(station.rules);
      return { matchingTrackCount };
    }
  );

  app.post(
    "/api/stations/preview",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const body = request.body as {
        stationId?: string;
        rules?: unknown;
      };

      if (!body?.stationId && !body?.rules) {
        return sendError(reply, 400, "BAD_REQUEST", "Provide stationId or rules");
      }

      let rulesInput: unknown = body.rules;

      if (body.stationId && !rulesInput) {
        const station = await getStationById(request.appUser.id, body.stationId);

        if (!station) {
          return sendError(reply, 404, "NOT_FOUND", "Station not found");
        }

        rulesInput = station.rules;
      }

      const parsedRules = StationRulesSchema.safeParse(rulesInput);

      if (!parsedRules.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid rules payload", parsedRules.error.flatten());
      }

      const matchingTrackCount = await getStationPreviewCount(parsedRules.data);
      return { matchingTrackCount };
    }
  );

  app.get(
    "/api/stations/:id",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const station = await getStationById(request.appUser.id, id);

      if (!station) {
        return sendError(reply, 404, "NOT_FOUND", "Station not found");
      }

      return { station };
    }
  );

  app.put(
    "/api/stations/:id",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const parsed = UpdateStationSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid station update", parsed.error.flatten());
      }

      const { id } = request.params as { id: string };
      const station = await updateStation(request.appUser.id, id, parsed.data);

      if (!station) {
        return sendError(reply, 404, "NOT_FOUND", "Station not found");
      }

      return { station };
    }
  );

  app.delete(
    "/api/stations/:id",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await deleteStation(request.appUser.id, id);

      if (!deleted) {
        return sendError(reply, 404, "NOT_FOUND", "Station not found");
      }

      return { ok: true };
    }
  );

  app.post(
    "/api/stations/:id/play",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const station = await getStationById(request.appUser.id, id);
      const body = request.body as { seed?: string } | undefined;

      if (!station) {
        return sendError(reply, 404, "NOT_FOUND", "Station not found");
      }

      try {
        const nowPlaying = await advanceNextTrack(station.id, request.appUser.id, {
          seed: body?.seed
        });
        const nextUp = await peekNextTracks(station.id, request.appUser.id, 10, {
          seed: body?.seed
        });

        return {
          nowPlaying,
          nextUp,
          station
        };
      } catch (error) {
        return sendError(reply, 400, "BAD_REQUEST", "Failed to start station", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  app.post(
    "/api/stations/:id/next",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const station = await getStationById(request.appUser.id, id);

      if (!station) {
        return sendError(reply, 404, "NOT_FOUND", "Station not found");
      }

      const body = request.body as
        | {
            previousTrackId?: string;
            listenSeconds?: number;
            skipped?: boolean;
            seed?: string;
          }
        | undefined;

      if (body?.previousTrackId) {
        await prisma.playEvent.create({
          data: {
            userId: request.appUser.id,
            stationId: station.id,
            navidromeSongId: body.previousTrackId,
            skipped: body.skipped ?? true,
            listenSeconds: body.listenSeconds ?? null
          }
        });
      }

      try {
        const track = await advanceNextTrack(station.id, request.appUser.id, {
          seed: body?.seed
        });
        return { track };
      } catch (error) {
        return sendError(reply, 400, "BAD_REQUEST", "Failed to get next track", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  app.get(
    "/api/stations/:id/peek",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const station = await getStationById(request.appUser.id, id);

      if (!station) {
        return sendError(reply, 404, "NOT_FOUND", "Station not found");
      }

      const query = request.query as { n?: string; seed?: string };
      const parsedN = Number(query.n ?? "10");
      const n = Number.isFinite(parsedN) ? Math.min(50, Math.max(1, parsedN)) : 10;

      try {
        const tracks = await peekNextTracks(station.id, request.appUser.id, n, {
          seed: query.seed
        });
        return {
          tracks
        };
      } catch (error) {
        return sendError(reply, 400, "BAD_REQUEST", "Failed to peek station queue", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );
};
