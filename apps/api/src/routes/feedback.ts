import type { FastifyPluginAsync } from "fastify";
import { FeedbackInputSchema } from "@music-cable-box/shared";
import { prisma } from "../db";
import { sendError } from "../lib/errors";

export const feedbackRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/feedback",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const parsed = FeedbackInputSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "Invalid feedback payload", parsed.error.flatten());
      }

      const { navidromeSongId, liked, disliked } = parsed.data;

      const feedback = await prisma.trackFeedback.upsert({
        where: {
          userId_navidromeSongId: {
            userId: request.appUser.id,
            navidromeSongId
          }
        },
        update: {
          liked: liked ?? false,
          disliked: disliked ?? false
        },
        create: {
          userId: request.appUser.id,
          navidromeSongId,
          liked: liked ?? false,
          disliked: disliked ?? false
        }
      });

      return {
        feedback
      };
    }
  );
};
