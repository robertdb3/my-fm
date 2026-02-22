import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/health", async () => {
    return {
      ok: true,
      now: new Date().toISOString()
    };
  });
};
