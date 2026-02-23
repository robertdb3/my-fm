import type { FastifyPluginAsync } from "fastify";
import {
  type AudioMode,
  CreateStationSchema,
  PatchStationSchema,
  StationRulesSchema,
  SystemRegenerateInputSchema,
  TunerStepInputSchema,
  UpdateStationSchema
} from "@music-cable-box/shared";
import { prisma } from "../db";
import { sendError } from "../lib/errors";
import {
  createStation,
  deleteStation,
  getStationById,
  listStations,
  listTunerStations,
  patchStation,
  updateStation
} from "../services/station-service";
import { advanceNextTrack, getStationPreviewCount, peekNextTracks } from "../services/station-generator";
import { regenerateSystemStations } from "../services/station-auto-generator";
import { buildStreamProxyUrl } from "../services/stream-proxy";
import { getUserAudioMode } from "../services/user-settings-service";
import { sendNowPlayingScrobble, submitTrackScrobbleIfEligible } from "../services/scrobble-service";

export const stationRoutes: FastifyPluginAsync = async (app) => {
  const parseBoolean = (value: string | undefined): boolean => value === "true" || value === "1";
  const getRequestOrigin = (request: { headers: Record<string, unknown>; protocol: string }) => {
    const forwardedProto = request.headers["x-forwarded-proto"];
    const protocol =
      typeof forwardedProto === "string" && forwardedProto.trim().length > 0
        ? forwardedProto.split(",")[0]?.trim() ?? request.protocol
        : request.protocol;
    const host = typeof request.headers.host === "string" ? request.headers.host : "localhost:4000";

    return `${protocol}://${host}`;
  };
  const getAccessTokenFromRequest = (request: { headers: Record<string, unknown> }) => {
    const header = request.headers.authorization;
    if (typeof header !== "string") {
      return null;
    }

    if (!header.startsWith("Bearer ")) {
      return null;
    }

    const token = header.slice(7).trim();
    return token.length > 0 ? token : null;
  };
  const toProxyTrack = (params: {
    track: {
      navidromeSongId: string;
      title: string;
      artist: string;
      album: string | null;
      durationSec: number | null;
      artworkUrl: string | null;
      streamUrl: string;
      genre?: string | null;
      year?: number | null;
    };
    mode: AudioMode;
    offsetSec?: number;
    request: {
      headers: Record<string, unknown>;
      protocol: string;
    };
    accessToken: string;
  }) => {
    return {
      ...params.track,
      streamUrl: buildStreamProxyUrl({
        origin: getRequestOrigin(params.request),
        navidromeSongId: params.track.navidromeSongId,
        mode: params.mode,
        accessToken: params.accessToken,
        offsetSec: params.offsetSec
      })
    };
  };
  const stepIndex = (
    currentIndex: number,
    direction: "NEXT" | "PREV",
    stationCount: number,
    wrap: boolean
  ) => {
    if (stationCount <= 0) {
      return 0;
    }

    const delta = direction === "NEXT" ? 1 : -1;
    if (wrap) {
      return (currentIndex + delta + stationCount) % stationCount;
    }

    return Math.min(stationCount - 1, Math.max(0, currentIndex + delta));
  };

  app.get(
    "/api/stations",
    {
      preHandler: app.authenticate
    },
    async (request) => {
      const query = request.query as {
        includeHidden?: string;
        includeSystem?: string;
      };
      const stations = await listStations(request.appUser.id, {
        includeHidden: parseBoolean(query.includeHidden),
        includeSystem: query.includeSystem === undefined ? undefined : parseBoolean(query.includeSystem)
      });
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
    "/api/stations/tuner",
    {
      preHandler: app.authenticate
    },
    async (request) => {
      const stations = await listTunerStations(request.appUser.id);
      return { stations };
    }
  );

  app.post(
    "/api/tuner/step",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const parsed = TunerStepInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid tuner step payload", parsed.error.flatten());
      }

      const tunerStations = await listTunerStations(request.appUser.id);
      if (tunerStations.length === 0) {
        return sendError(reply, 404, "NOT_FOUND", "No tuner stations available");
      }

      const fromIndex = parsed.data.fromStationId
        ? tunerStations.findIndex((station) => station.id === parsed.data.fromStationId)
        : -1;

      const currentIndex =
        fromIndex >= 0 ? fromIndex : parsed.data.direction === "NEXT" ? -1 : 0;
      const targetIndex = stepIndex(
        currentIndex,
        parsed.data.direction,
        tunerStations.length,
        parsed.data.wrap
      );
      const targetStation = tunerStations[targetIndex];

      if (!targetStation) {
        return sendError(reply, 404, "NOT_FOUND", "Target tuner station not found");
      }

      if (!parsed.data.play) {
        return {
          station: targetStation
        };
      }

      const station = await getStationById(request.appUser.id, targetStation.id);
      if (!station) {
        return sendError(reply, 404, "NOT_FOUND", "Station not found");
      }

      if (!station.isEnabled) {
        return sendError(reply, 400, "BAD_REQUEST", "Station is disabled");
      }

      try {
        const accessToken = getAccessTokenFromRequest(request);
        if (!accessToken) {
          return sendError(reply, 401, "UNAUTHORIZED", "Authentication required");
        }
        const mode = await getUserAudioMode(request.appUser.id);
        const result = await advanceNextTrack(station.id, request.appUser.id, {
          reason: "manual"
        });
        const nextUp = await peekNextTracks(station.id, request.appUser.id, 10);
        const nowPlaying = toProxyTrack({
          track: result.track,
          mode,
          request,
          accessToken,
          offsetSec: result.playback.startOffsetSec
        });
        void sendNowPlayingScrobble({
          userId: request.appUser.id,
          navidromeSongId: result.track.navidromeSongId,
          log: request.log
        });
        const proxiedNextUp = nextUp.map((track) =>
          toProxyTrack({
            track,
            mode,
            request,
            accessToken
          })
        );

        return {
          station: targetStation,
          nowPlaying,
          nextUp: proxiedNextUp,
          playback: result.playback
        };
      } catch (error) {
        return sendError(reply, 400, "BAD_REQUEST", "Failed to tune station", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  app.post(
    "/api/stations/system/regenerate",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const parsed = SystemRegenerateInputSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid regenerate payload", parsed.error.flatten());
      }

      const result = await regenerateSystemStations(request.appUser.id, parsed.data);
      return result;
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

  app.patch(
    "/api/stations/:id",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const parsed = PatchStationSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid station patch", parsed.error.flatten());
      }

      const { id } = request.params as { id: string };

      try {
        const station = await patchStation(request.appUser.id, id, parsed.data);

        if (!station) {
          return sendError(reply, 404, "NOT_FOUND", "Station not found");
        }

        return { station };
      } catch (error) {
        return sendError(reply, 400, "BAD_REQUEST", error instanceof Error ? error.message : "Patch failed");
      }
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
      const body = (request.body ?? {}) as { seed?: string; reason?: "manual" | "resume" };

      if (!station) {
        return sendError(reply, 404, "NOT_FOUND", "Station not found");
      }

      try {
        const accessToken = getAccessTokenFromRequest(request);
        if (!accessToken) {
          return sendError(reply, 401, "UNAUTHORIZED", "Authentication required");
        }
        const mode = await getUserAudioMode(request.appUser.id);
        const nowPlaying = await advanceNextTrack(station.id, request.appUser.id, {
          seed: body.seed,
          reason: body.reason ?? "manual"
        });
        const nextUp = await peekNextTracks(station.id, request.appUser.id, 10, {
          seed: body.seed
        });
        const proxiedNowPlaying = toProxyTrack({
          track: nowPlaying.track,
          mode,
          request,
          accessToken,
          offsetSec: nowPlaying.playback.startOffsetSec
        });
        void sendNowPlayingScrobble({
          userId: request.appUser.id,
          navidromeSongId: nowPlaying.track.navidromeSongId,
          log: request.log
        });
        const proxiedNextUp = nextUp.map((track) =>
          toProxyTrack({
            track,
            mode,
            request,
            accessToken
          })
        );

        return {
          nowPlaying: proxiedNowPlaying,
          nextUp: proxiedNextUp,
          station,
          playback: nowPlaying.playback
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
            previousStartOffsetSec?: number;
            previousReason?: string;
          }
        | undefined;
      const payload = body ?? {};

      if (payload.previousTrackId) {
        const listenSeconds = payload.listenSeconds ?? 0;
        const startedAtMs = Date.now() - Math.max(0, Math.floor(listenSeconds)) * 1000;
        void submitTrackScrobbleIfEligible({
          userId: request.appUser.id,
          navidromeSongId: payload.previousTrackId,
          listenSeconds,
          startedAtMs,
          log: request.log
        });
        await prisma.playEvent.create({
          data: {
            userId: request.appUser.id,
            stationId: station.id,
            navidromeSongId: payload.previousTrackId,
            skipped: payload.skipped ?? true,
            listenSeconds: payload.listenSeconds ?? null,
            startOffsetSec: payload.previousStartOffsetSec ?? null,
            reason: payload.previousReason ?? null
          }
        });
      }

      try {
        const accessToken = getAccessTokenFromRequest(request);
        if (!accessToken) {
          return sendError(reply, 401, "UNAUTHORIZED", "Authentication required");
        }
        const mode = await getUserAudioMode(request.appUser.id);
        const track = await advanceNextTrack(station.id, request.appUser.id, {
          seed: payload.seed,
          reason: "next"
        });
        void sendNowPlayingScrobble({
          userId: request.appUser.id,
          navidromeSongId: track.track.navidromeSongId,
          log: request.log
        });
        const proxiedTrack = toProxyTrack({
          track: track.track,
          mode,
          request,
          accessToken
        });
        return {
          track: proxiedTrack,
          playback: track.playback.reason === "next" ? track.playback : undefined
        };
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
        const accessToken = getAccessTokenFromRequest(request);
        if (!accessToken) {
          return sendError(reply, 401, "UNAUTHORIZED", "Authentication required");
        }
        const mode = await getUserAudioMode(request.appUser.id);
        const tracks = await peekNextTracks(station.id, request.appUser.id, n, {
          seed: query.seed
        });
        const proxiedTracks = tracks.map((track) =>
          toProxyTrack({
            track,
            mode,
            request,
            accessToken
          })
        );
        return {
          tracks: proxiedTracks
        };
      } catch (error) {
        return sendError(reply, 400, "BAD_REQUEST", "Failed to peek station queue", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );
};
