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

const tmpDir = mkdtempSync(join(tmpdir(), "music-cable-box-api-test-"));
const dbPath = join(tmpDir, "test.db");
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
    data: [
      {
        navidromeSongId: "song-a",
        title: "Song A",
        artist: "Artist A",
        album: "Album A",
        genre: "Rock",
        durationSec: 200
      },
      {
        navidromeSongId: "song-b",
        title: "Song B",
        artist: "Artist B",
        album: "Album B",
        genre: "Rock",
        durationSec: 210
      },
      {
        navidromeSongId: "song-c",
        title: "Song C",
        artist: "Artist C",
        album: "Album C",
        genre: "Pop",
        durationSec: 220
      }
    ]
  });
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

describe("stations endpoints", () => {
  it("creates a station and starts playback", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/stations",
      headers: {
        authorization: `Bearer ${authToken}`
      },
      payload: {
        name: "Rock Channel",
        description: "Rock-heavy station",
        rules: {
          includeGenres: ["Rock"]
        },
        isEnabled: true
      }
    });

    expect(createResponse.statusCode).toBe(201);
    stationId = createResponse.json().station.id;

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/stations",
      headers: {
        authorization: `Bearer ${authToken}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().stations).toHaveLength(1);

    const previewByIdResponse = await app.inject({
      method: "GET",
      url: `/api/stations/preview?stationId=${stationId}`,
      headers: {
        authorization: `Bearer ${authToken}`
      }
    });

    expect(previewByIdResponse.statusCode).toBe(200);
    expect(previewByIdResponse.json().matchingTrackCount).toBe(2);

    const previewByRulesResponse = await app.inject({
      method: "POST",
      url: "/api/stations/preview",
      headers: {
        authorization: `Bearer ${authToken}`
      },
      payload: {
        rules: {
          includeGenres: ["Pop"]
        }
      }
    });

    expect(previewByRulesResponse.statusCode).toBe(200);
    expect(previewByRulesResponse.json().matchingTrackCount).toBe(1);

    const ruleOptionsResponse = await app.inject({
      method: "GET",
      url: "/api/stations/rule-options?field=genre&q=Ro",
      headers: {
        authorization: `Bearer ${authToken}`
      }
    });

    expect(ruleOptionsResponse.statusCode).toBe(200);
    expect(ruleOptionsResponse.json().options).toContain("Rock");

    const playResponse = await app.inject({
      method: "POST",
      url: `/api/stations/${stationId}/play`,
      headers: {
        authorization: `Bearer ${authToken}`
      }
    });

    expect(playResponse.statusCode).toBe(200);
    const payload = playResponse.json();

    expect(payload.nowPlaying).toBeDefined();
    expect(payload.nowPlaying.streamUrl).toContain("/rest/stream.view");
    expect(payload.nextUp.length).toBeGreaterThan(0);
  });
});
