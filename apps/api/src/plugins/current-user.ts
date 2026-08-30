import fp from "fastify-plugin";
import { getLocalUser } from "../services/user-service";

export const currentUserPlugin = fp(async (app) => {
  app.addHook("onRequest", async (request) => {
    request.appUser = await getLocalUser();
  });
});
