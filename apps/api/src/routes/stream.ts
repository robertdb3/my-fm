import { spawn } from "node:child_process";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { AudioModeSchema } from "@music-cable-box/shared";
import { prisma } from "../db";
import { sendError } from "../lib/errors";
import { getClientForUser } from "../services/library-import-service";
import { buildFfmpegPlan, defaultBitrateForMode } from "../services/stream-proxy";
import { getUserAudioMode } from "../services/user-settings-service";

const StreamQuerySchema = z.object({
  mode: AudioModeSchema.optional(),
  offsetSec: z.coerce.number().int().min(0).max(60 * 60 * 24).optional(),
  format: z.enum(["mp3", "aac"]).optional(),
  bitrateKbps: z.coerce.number().int().min(32).max(320).optional(),
  accessToken: z.string().min(1).optional()
});

interface JwtPayload {
  sub: string;
}

async function authenticateStreamRequest(request: FastifyRequest) {
  const authHeader = request.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    const payload = await request.jwtVerify<JwtPayload>();
    return payload.sub;
  }

  const parsedQuery = StreamQuerySchema.safeParse(request.query);
  const accessToken = parsedQuery.success ? parsedQuery.data.accessToken : undefined;
  if (!accessToken) {
    throw new Error("Authentication required");
  }

  const payload = await request.server.jwt.verify<JwtPayload>(accessToken);
  return payload.sub;
}

export const streamRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/api/stream/:navidromeSongId",
    async (request, reply) => {
      const params = request.params as { navidromeSongId: string };
      const queryParsed = StreamQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid stream query", queryParsed.error.flatten());
      }

      let userId: string;
      try {
        userId = await authenticateStreamRequest(request);
      } catch {
        return sendError(reply, 401, "UNAUTHORIZED", "Authentication required");
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true }
      });
      if (!user) {
        return sendError(reply, 401, "UNAUTHORIZED", "Session is not valid");
      }

      const client = await getClientForUser(userId);
      const defaultMode = await getUserAudioMode(userId);
      const mode = queryParsed.data.mode ?? defaultMode;
      const offsetSec = queryParsed.data.offsetSec ?? 0;
      const bitrateKbps = queryParsed.data.bitrateKbps ?? defaultBitrateForMode(mode);

      const sourceUrl = client.buildStreamUrl(params.navidromeSongId, {
        timeOffsetSec: offsetSec
      });
      const ffmpegPlan = buildFfmpegPlan({
        sourceUrl,
        mode,
        format: queryParsed.data.format,
        bitrateKbps
      });

      request.log.info(
        {
          songId: params.navidromeSongId,
          mode: ffmpegPlan.mode,
          offsetSec,
          bitrateKbps: ffmpegPlan.bitrateKbps,
          format: ffmpegPlan.format
        },
        "Starting proxied audio stream"
      );

      const ffmpeg = spawn(ffmpegPlan.command, ffmpegPlan.args, {
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stderr = "";
      ffmpeg.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      const stopChildProcess = () => {
        if (!ffmpeg.killed) {
          ffmpeg.kill("SIGKILL");
        }
      };

      request.raw.on("close", stopChildProcess);
      reply.raw.on("close", stopChildProcess);

      ffmpeg.on("error", (error) => {
        request.log.error({ err: error }, "Failed to spawn ffmpeg process");
        if (!reply.raw.headersSent) {
          reply.code(500).send({
            error: {
              code: "INTERNAL_ERROR",
              message: "Failed to start audio transcoder"
            }
          });
        } else {
          reply.raw.destroy(error);
        }
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          request.log.warn(
            { code, stderr: stderr.slice(0, 500) },
            "ffmpeg process exited with non-zero code"
          );
        }
      });

      reply.header("Content-Type", ffmpegPlan.contentType);
      reply.header("Cache-Control", "no-store");
      return reply.send(ffmpeg.stdout);
    }
  );
};
