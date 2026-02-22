import "dotenv/config";
import { createApp } from "./app";
import { env } from "./config";

const app = createApp();

app
  .listen({
    port: env.PORT,
    host: env.HOST
  })
  .then(() => {
    app.log.info(`API listening on http://${env.HOST}:${env.PORT}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
