import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db";
import { env } from "../config";
import { sendError } from "../lib/errors";

interface JwtPayload {
  sub: string;
}

export const authPlugin = fp(async (app) => {
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });

  app.decorate(
    "authenticate",
    async function authenticate(request: FastifyRequest, reply: FastifyReply) {
      try {
        const decoded = await request.jwtVerify<JwtPayload>();
        const user = await prisma.user.findUnique({ where: { id: decoded.sub } });

        if (!user) {
          sendError(reply, 401, "UNAUTHORIZED", "Session is not valid");
          return;
        }

        request.appUser = user;
      } catch {
        sendError(reply, 401, "UNAUTHORIZED", "Authentication required");
        return;
      }
    }
  );
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
