import { execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

let latestSpawnArgs: string[] = [];

function spawnMock(_command: string, args: string[]) {
  latestSpawnArgs = args;

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const processEmitter = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill: () => boolean;
  };

  processEmitter.stdout = stdout;
  processEmitter.stderr = stderr;
  processEmitter.killed = false;
  processEmitter.kill = () => {
    processEmitter.killed = true;
    processEmitter.emit("close", 0);
    return true;
  };

  setTimeout(() => {
    stdout.write("ID3");
    stdout.end();
    processEmitter.emit("close", 0);
  }, 0);

  return processEmitter;
}

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock
  };
});

let app: FastifyInstance;
let prisma: PrismaClient;
let authToken = "";

const tmpDir = mkdtempSync(join(tmpdir(), "music-cable-box-api-stream-test-"));
const dbPath = join(tmpDir, "stream-test.db");
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
  process.env.FFMPEG_PATH = "ffmpeg";

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

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: { audioMode: "FM" },
    create: {
      userId: user.id,
      audioMode: "FM"
    }
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

describe("stream proxy endpoint", () => {
  it("reads and updates user audio settings", async () => {
    const getResponse = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: {
        authorization: `Bearer ${authToken}`
      }
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().settings.audioMode).toBe("FM");

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: {
        authorization: `Bearer ${authToken}`
      },
      payload: {
        audioMode: "AM"
      }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().settings.audioMode).toBe("AM");
  });

  it("returns audio/mpeg and uses FM profile when mode is explicit", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/stream/song-a?mode=FM&accessToken=${encodeURIComponent(authToken)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(latestSpawnArgs.join(" ")).toContain("highpass=f=80");
    expect(latestSpawnArgs.join(" ")).toContain("anoisesrc=");
  });

  it("returns audio/aac and uses AM profile when requested", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/stream/song-b?mode=AM&format=aac&accessToken=${encodeURIComponent(authToken)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("audio/aac");
    expect(latestSpawnArgs.join(" ")).toContain("channel_layouts=mono");
    expect(latestSpawnArgs.join(" ")).toContain("lowpass=f=3400");
  });

  it("applies offset through ffmpeg trim filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/stream/song-offset?mode=FM&offsetSec=37&accessToken=${encodeURIComponent(authToken)}`
    });

    expect(response.statusCode).toBe(200);
    const args = latestSpawnArgs.join(" ");
    expect(args).toContain("atrim=start=37");
    expect(args).not.toContain("timeOffset=37");
  });

  it("uses user settings mode when mode query is omitted", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/stream/song-c?accessToken=${encodeURIComponent(authToken)}`
    });

    expect(response.statusCode).toBe(200);
    expect(latestSpawnArgs.join(" ")).toContain("channel_layouts=mono");
  });
});
