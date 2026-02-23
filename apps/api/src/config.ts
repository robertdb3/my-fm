import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  APP_LOGIN_EMAIL: z.string().email().default("admin@example.com"),
  APP_LOGIN_PASSWORD: z.string().min(1).default("change-me"),
  SUBSONIC_CLIENT_NAME: z.string().default("music-cable-box"),
  SUBSONIC_API_VERSION: z.string().default("1.16.1"),
  NAVIDROME_DEFAULT_URL: z.string().url().optional(),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  SCROBBLE_ENABLED: z.coerce.boolean().default(true),
  SCROBBLE_MIN_LISTEN_SECONDS: z.coerce.number().int().min(1).max(600).default(30),
  SCROBBLE_REQUIRED_PERCENT: z.coerce.number().min(0.1).max(1).default(0.5),
  SCROBBLE_MAX_REQUIRED_SECONDS: z.coerce.number().int().min(30).max(1800).default(240)
});

export const env = EnvSchema.parse(process.env);
