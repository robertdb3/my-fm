import type { FastifyPluginAsync } from "fastify";
import { LoginInputSchema } from "@music-cable-box/shared";
import { env } from "../config";
import { sendError } from "../lib/errors";
import { ensureUserByEmail } from "../services/user-service";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/auth/login", async (request, reply) => {
    const parsed = LoginInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendError(reply, 400, "BAD_REQUEST", "Invalid login payload", parsed.error.flatten());
    }

    const { email, password } = parsed.data;

    if (email !== env.APP_LOGIN_EMAIL || password !== env.APP_LOGIN_PASSWORD) {
      return sendError(reply, 401, "UNAUTHORIZED", "Invalid credentials");
    }

    const user = await ensureUserByEmail(email);

    const token = await reply.jwtSign({
      sub: user.id,
      email: user.email
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email
      }
    };
  });
};
