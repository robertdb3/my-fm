import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

let app: FastifyInstance;
let prisma: PrismaClient;
let authToken = "";
let stationId = "";

const tmpDir = mkdtempSync(join(tmpdir(), "music-cable-box-api-seq-test-"));
const dbPath = join(tmpDir, "test-seq.db");
const databaseUrl = `file:${dbPath}`;
const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = "test-secret-test-secret";
  process.env.APP_LOGIN_EMAIL = "admin@example.com";
  process.env.APP_LOGIN_PASSWORD = "change-me";
  process.env.SUBSONIC_CLIENT_NAME = "music-cable-box";
  process.env.SUBSONIC_API_VERSION = "1.16.1";

  execSync("pnpm prisma db push --skip-generate --accept-data-loss", {
    cwd: apiDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RUST_LOG: "info"
    },
    stdio: "ignore"
  });

  const [{ createApp }, dbModule] = await Promise.all([import("../src/app"), import("../src/db")]);
  prisma = dbModule.prisma;
  app = createApp();
  await app.ready();

  const loginResponse = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: "admin@example.com",
      password: "change-me"
    }
  });

  expect(loginResponse.statusCode).toBe(200);
  authToken = loginResponse.json().token;

  const user = await prisma.user.findUnique({
    where: {
      email: "admin@example.com"
    }
  });

  if (!user) {
    throw new Error("Expected login user to exist");
  }

  await prisma.navidromeAccount.create({
    data: {
      userId: user.id,
      baseUrl: "http://navidrome.local",
      username: "navidrome-user",
      token: "subsonic-token",
      salt: "salt123"
    }
  });

  await prisma.trackCache.createMany({
    data: Array.from({ length: 80 }).map((_, index) => ({
      navidromeSongId: `rock-song-${index + 1}`,
      title: `Rock Song ${index + 1}`,
      artist: `Artist ${index + 1}`,
      album: `Album ${Math.floor(index / 10) + 1}`,
      genre: "Rock",
      year: 2000 + (index % 20),
      durationSec: 150 + index,
      addedAt: new Date("2025-01-01T00:00:00.000Z")
    }))
  });

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/stations",
    headers: {
      authorization: `Bearer ${authToken}`
    },
    payload: {
      name: "Large Rock Pool",
      description: "For non-repeat integration test",
      rules: {
        includeGenres: ["Rock"],
        avoidRepeatHours: 24,
        artistSeparation: 3
      },
      isEnabled: true
    }
  });

  expect(createResponse.statusCode).toBe(201);
  stationId = createResponse.json().station.id;
});

afterAll(async () => {
  if (app) {
    await app.close();
  }

  if (prisma) {
    await prisma.$disconnect();
  }

  rmSync(tmpDir, { recursive: true, force: true });
});

describe("station generator sequential next", () => {
  it("returns 50 sequential next tracks without duplicates inside 24h window", async () => {
    const seenTrackIds: string[] = [];

    for (let i = 0; i < 50; i += 1) {
      const nextResponse = await app.inject({
        method: "POST",
        url: `/api/stations/${stationId}/next`,
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(nextResponse.statusCode).toBe(200);
      seenTrackIds.push(nextResponse.json().track.navidromeSongId);
    }

    const unique = new Set(seenTrackIds);
    expect(unique.size).toBe(50);
  });
});
