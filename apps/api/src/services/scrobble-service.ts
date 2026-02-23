import { prisma } from "../db";
import { env } from "../config";
import { getClientForUser } from "./library-import-service";

interface LoggerLike {
  warn(bindings: Record<string, unknown>, message?: string): void;
}

interface ScrobbleThresholdInput {
  listenSeconds: number | null | undefined;
  durationSec: number | null | undefined;
}

function normalizeSeconds(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value ?? 0));
}

export function shouldSubmitScrobble(input: ScrobbleThresholdInput): boolean {
  const listenSeconds = normalizeSeconds(input.listenSeconds);
  const durationSec = normalizeSeconds(input.durationSec);

  if (!env.SCROBBLE_ENABLED || listenSeconds <= 0) {
    return false;
  }

  const requiredFromDuration =
    durationSec > 0
      ? Math.min(env.SCROBBLE_MAX_REQUIRED_SECONDS, Math.floor(durationSec * env.SCROBBLE_REQUIRED_PERCENT))
      : env.SCROBBLE_MIN_LISTEN_SECONDS;

  const threshold = Math.max(env.SCROBBLE_MIN_LISTEN_SECONDS, requiredFromDuration);
  return listenSeconds >= threshold;
}

export async function sendNowPlayingScrobble(params: {
  userId: string;
  navidromeSongId: string;
  startedAtMs?: number;
  log?: LoggerLike;
}): Promise<void> {
  if (!env.SCROBBLE_ENABLED) {
    return;
  }

  try {
    const client = await getClientForUser(params.userId);
    await client.scrobble(params.navidromeSongId, {
      submission: false,
      timeMs: params.startedAtMs ?? Date.now()
    });
  } catch (error) {
    params.log?.warn(
      {
        err: error,
        userId: params.userId,
        navidromeSongId: params.navidromeSongId
      },
      "Failed to send now-playing scrobble"
    );
  }
}

export async function submitTrackScrobbleIfEligible(params: {
  userId: string;
  navidromeSongId: string;
  listenSeconds: number | null | undefined;
  startedAtMs?: number;
  log?: LoggerLike;
}): Promise<boolean> {
  if (!env.SCROBBLE_ENABLED) {
    return false;
  }

  const duration = await prisma.trackCache.findUnique({
    where: {
      navidromeSongId: params.navidromeSongId
    },
    select: {
      durationSec: true
    }
  });

  const shouldSubmit = shouldSubmitScrobble({
    listenSeconds: params.listenSeconds,
    durationSec: duration?.durationSec
  });

  if (!shouldSubmit) {
    return false;
  }

  try {
    const listenSeconds = normalizeSeconds(params.listenSeconds);
    const fallbackStartedAtMs = Date.now() - listenSeconds * 1000;
    const startedAtMs = Math.max(0, Math.floor(params.startedAtMs ?? fallbackStartedAtMs));
    const client = await getClientForUser(params.userId);
    await client.scrobble(params.navidromeSongId, {
      submission: true,
      timeMs: startedAtMs
    });
    return true;
  } catch (error) {
    params.log?.warn(
      {
        err: error,
        userId: params.userId,
        navidromeSongId: params.navidromeSongId
      },
      "Failed to submit track scrobble"
    );
    return false;
  }
}
