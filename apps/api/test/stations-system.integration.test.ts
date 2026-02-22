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

const tmpDir = mkdtempSync(join(tmpdir(), "music-cable-box-api-system-test-"));
const dbPath = join(tmpDir, "system-test.db");
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

  await prisma.trackCache.createMany({
    data: [
      {
        navidromeSongId: "alpha-1",
        title: "Alpha One",
        artist: "The Alpha",
        genre: "Rock",
        year: 1991,
        durationSec: 200
      },
      {
        navidromeSongId: "alpha-2",
        title: "Alpha Two",
        artist: "The Alpha",
        genre: "Rock",
        year: 1994,
        durationSec: 202
      },
      {
        navidromeSongId: "alpha-3",
        title: "Alpha Three",
        artist: "The Alpha",
        genre: "Rock",
        year: 1999,
        durationSec: 205
      },
      {
        navidromeSongId: "beta-1",
        title: "Beta One",
        artist: "Beta Crew",
        genre: "Rock",
        year: 1996,
        durationSec: 180
      },
      {
        navidromeSongId: "beta-2",
        title: "Beta Two",
        artist: "Beta Crew",
        genre: "Jazz",
        year: 2002,
        durationSec: 186
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

describe("system station regeneration", () => {
  it("creates expected system stations and hides stale ones", async () => {
    const regenerateResponse = await app.inject({
      method: "POST",
      url: "/api/stations/system/regenerate",
      headers: {
        authorization: `Bearer ${authToken}`
      },
      payload: {
        minTracks: {
          artist: 3,
          genre: 3,
          decade: 3
        }
      }
    });

    expect(regenerateResponse.statusCode).toBe(200);
    const regeneratePayload = regenerateResponse.json();
    expect(regeneratePayload.created).toBe(3);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/stations?includeHidden=true",
      headers: {
        authorization: `Bearer ${authToken}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    const stations = listResponse.json().stations as Array<{
      name: string;
      isSystem: boolean;
      systemType: "ARTIST" | "GENRE" | "DECADE" | null;
      isHidden: boolean;
    }>;
    expect(stations.filter((station) => station.isSystem)).toHaveLength(3);
    expect(stations.some((station) => station.name.includes("Artist Radio: The Alpha"))).toBe(true);
    expect(stations.some((station) => station.name.includes("Genre Radio: Rock"))).toBe(true);
    expect(stations.some((station) => station.name.includes("1990s Radio"))).toBe(true);

    const staleRegenerateResponse = await app.inject({
      method: "POST",
      url: "/api/stations/system/regenerate",
      headers: {
        authorization: `Bearer ${authToken}`
      },
      payload: {
        minTracks: {
          artist: 999,
          genre: 999,
          decade: 999
        }
      }
    });

    expect(staleRegenerateResponse.statusCode).toBe(200);
    expect(staleRegenerateResponse.json().disabledOrHidden).toBe(3);

    const visibleListResponse = await app.inject({
      method: "GET",
      url: "/api/stations",
      headers: {
        authorization: `Bearer ${authToken}`
      }
    });

    expect(visibleListResponse.statusCode).toBe(200);
    expect(visibleListResponse.json().stations).toHaveLength(0);
  });
});
