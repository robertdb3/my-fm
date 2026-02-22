import type { Prisma, TrackCache } from "@prisma/client";
import { StationRulesSchema, type StationRules, type Track } from "@music-cable-box/shared";
import { prisma } from "../db";
import { getClientForUser } from "./library-import-service";

const STATE_CAP = 200;
const CANDIDATE_LIMIT = 5000;
const TOP_K = 500;

interface GenerationState {
  recentTrackIds: string[];
  recentArtistNames: string[];
  lastPlayedAt: Date | null;
  lastTrackId: string | null;
}

interface GenerationContext {
  stationId: string;
  userId: string;
  rules: StationRules;
  state: GenerationState;
  streamClient: Awaited<ReturnType<typeof getClientForUser>>;
  candidates: TrackCache[];
  lastPlayedMap: Map<string, Date>;
  feedbackMap: Map<
    string,
    {
      liked: boolean;
      disliked: boolean;
    }
  >;
}

interface ScoredCandidate {
  track: TrackCache;
  score: number;
}

function lower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function hashToUnit(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return (hash % 10_000) / 10_000;
}

function buildCandidateFilter(rules: StationRules): Prisma.TrackCacheWhereInput {
  const andClauses: Prisma.TrackCacheWhereInput[] = [];

  if (rules.genresInclude.length > 0) {
    andClauses.push({
      OR: rules.genresInclude.map((genre): Prisma.TrackCacheWhereInput => ({
        genre: { contains: genre }
      }))
    });
  }

  if (rules.genresExclude.length > 0) {
    andClauses.push({
      NOT: {
        OR: rules.genresExclude.map((genre): Prisma.TrackCacheWhereInput => ({
          genre: { contains: genre }
        }))
      }
    });
  }

  if (rules.yearMin !== undefined) {
    andClauses.push({ year: { gte: rules.yearMin } });
  }

  if (rules.yearMax !== undefined) {
    andClauses.push({ year: { lte: rules.yearMax } });
  }

  if (rules.artistsInclude.length > 0) {
    andClauses.push({
      OR: rules.artistsInclude.map((artist): Prisma.TrackCacheWhereInput => ({
        artist: { contains: artist }
      }))
    });
  }

  if (rules.artistsExclude.length > 0) {
    andClauses.push({
      NOT: {
        OR: rules.artistsExclude.map((artist): Prisma.TrackCacheWhereInput => ({
          artist: { contains: artist }
        }))
      }
    });
  }

  if (rules.albumsInclude.length > 0) {
    andClauses.push({
      OR: rules.albumsInclude.map((album): Prisma.TrackCacheWhereInput => ({
        album: { contains: album }
      }))
    });
  }

  if (rules.albumsExclude.length > 0) {
    andClauses.push({
      NOT: {
        OR: rules.albumsExclude.map((album): Prisma.TrackCacheWhereInput => ({
          album: { contains: album }
        }))
      }
    });
  }

  if (rules.recentlyAddedDays !== undefined) {
    const minAddedAt = new Date(Date.now() - rules.recentlyAddedDays * 24 * 60 * 60 * 1000);
    andClauses.push({ addedAt: { gte: minAddedAt } });
  }

  if (rules.durationMinSec !== undefined) {
    andClauses.push({ durationSec: { gte: rules.durationMinSec } });
  }

  if (rules.durationMaxSec !== undefined) {
    andClauses.push({ durationSec: { lte: rules.durationMaxSec } });
  }

  if (andClauses.length === 0) {
    return {};
  }

  return { AND: andClauses };
}

export function scoreCandidate(params: {
  track: TrackCache;
  rules: StationRules;
  recentArtistWindow: string[];
  lastPlayedAt: Date | undefined;
  feedback?: { liked: boolean; disliked: boolean };
  previousTrackId?: string | null;
  seedSalt?: string;
}) {
  const {
    track,
    rules,
    recentArtistWindow,
    lastPlayedAt,
    feedback,
    previousTrackId,
    seedSalt = ""
  } = params;

  let score = 0.5 + hashToUnit(`${track.navidromeSongId}:${seedSalt}`);

  if (!lastPlayedAt) {
    score += rules.preferUnplayedWeight * 1.25;
  } else {
    const hoursSinceLastPlay =
      Math.max(1, Date.now() - lastPlayedAt.getTime()) / (1000 * 60 * 60);
    score += Math.min(hoursSinceLastPlay / 720, 1) * rules.preferUnplayedWeight;
  }

  if (feedback?.liked) {
    score += rules.preferLikedWeight;
  }

  if (feedback?.disliked) {
    score -= rules.preferLikedWeight * 1.5;
  }

  if (recentArtistWindow.includes(lower(track.artist))) {
    score -= 2;
  }

  if (track.navidromeSongId === previousTrackId) {
    score -= 3;
  }

  return score;
}

function weightedPick(scored: ScoredCandidate[]): TrackCache | null {
  if (scored.length === 0) {
    return null;
  }

  const minScore = Math.min(...scored.map((item) => item.score));
  const shifted = scored.map((item) => ({
    ...item,
    weight: Math.max(0.01, item.score - minScore + 0.01)
  }));

  const totalWeight = shifted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const item of shifted) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.track;
    }
  }

  return shifted[shifted.length - 1]?.track ?? null;
}

function pushCapped(list: string[], value: string) {
  const next = [...list, value];
  if (next.length > STATE_CAP) {
    next.shift();
  }
  return next;
}

async function buildContext(userId: string, stationId: string): Promise<GenerationContext> {
  const streamClient = await getClientForUser(userId);
  const station = await prisma.station.findFirst({
    where: {
      id: stationId,
      userId,
      isEnabled: true
    }
  });

  if (!station) {
    throw new Error("Station not found or disabled");
  }

  const rules = StationRulesSchema.parse(station.rulesJson);

  const stateRow = await prisma.stationState.findUnique({
    where: { stationId: station.id }
  });

  const state: GenerationState = {
    recentTrackIds: asStringArray(stateRow?.recentTrackIdsJson),
    recentArtistNames: asStringArray(stateRow?.recentArtistNamesJson),
    lastPlayedAt: stateRow?.lastPlayedAt ?? null,
    lastTrackId: stateRow?.lastTrackId ?? null
  };

  const filter = buildCandidateFilter(rules);
  const allCandidates = await prisma.trackCache.findMany({
    where: filter,
    take: CANDIDATE_LIMIT
  });

  const repeatCutoff = new Date(Date.now() - rules.avoidRepeatHours * 60 * 60 * 1000);
  const recentEvents = await prisma.playEvent.findMany({
    where: {
      userId,
      playedAt: { gte: repeatCutoff }
    },
    select: { navidromeSongId: true }
  });

  const disallowedTracks = new Set<string>([
    ...state.recentTrackIds,
    ...recentEvents.map((event) => event.navidromeSongId)
  ]);

  let candidates = allCandidates.filter((track) => !disallowedTracks.has(track.navidromeSongId));
  if (candidates.length === 0) {
    candidates = allCandidates;
  }

  const candidateIds = candidates.map((track) => track.navidromeSongId);

  const playEvents = await prisma.playEvent.findMany({
    where: {
      userId,
      navidromeSongId: {
        in: candidateIds.length > 0 ? candidateIds : ["__none__"]
      }
    },
    orderBy: {
      playedAt: "desc"
    },
    select: {
      navidromeSongId: true,
      playedAt: true
    }
  });

  const lastPlayedMap = new Map<string, Date>();
  for (const event of playEvents) {
    if (!lastPlayedMap.has(event.navidromeSongId)) {
      lastPlayedMap.set(event.navidromeSongId, event.playedAt);
    }
  }

  const feedbackRows = await prisma.trackFeedback.findMany({
    where: {
      userId,
      navidromeSongId: {
        in: candidateIds.length > 0 ? candidateIds : ["__none__"]
      }
    },
    select: {
      navidromeSongId: true,
      liked: true,
      disliked: true
    }
  });

  const feedbackMap = new Map<string, { liked: boolean; disliked: boolean }>();
  for (const row of feedbackRows) {
    feedbackMap.set(row.navidromeSongId, {
      liked: row.liked,
      disliked: row.disliked
    });
  }

  if (rules.minRating !== undefined && rules.minRating >= 4) {
    candidates = candidates.filter((track) => feedbackMap.get(track.navidromeSongId)?.liked);
  }

  if (candidates.length === 0) {
    throw new Error("No tracks match this station configuration");
  }

  return {
    stationId: station.id,
    userId,
    rules,
    state,
    streamClient,
    candidates,
    lastPlayedMap,
    feedbackMap
  };
}

function pickNextTrack(
  context: GenerationContext,
  state: GenerationState,
  pickedIds: Set<string>
): TrackCache {
  const recentArtistWindow = state.recentArtistNames
    .slice(-context.rules.avoidSameArtistWithinTracks)
    .map((artist) => lower(artist));

  let pool = context.candidates.filter((track) => !pickedIds.has(track.navidromeSongId));

  if (pool.length === 0) {
    pool = context.candidates;
  }

  const scored = pool
    .map((track) => {
      const feedback = context.feedbackMap.get(track.navidromeSongId);
      const lastPlayedAt = context.lastPlayedMap.get(track.navidromeSongId);

      return {
        track,
        score: scoreCandidate({
          track,
          rules: context.rules,
          recentArtistWindow,
          lastPlayedAt,
          feedback,
          previousTrackId: state.lastTrackId,
          seedSalt: `${Date.now().toString().slice(0, 8)}:${state.lastTrackId ?? ""}`
        })
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  const selected = weightedPick(scored);
  if (!selected) {
    throw new Error("Failed to select a track from station candidates");
  }

  return selected;
}

function advanceLocalState(state: GenerationState, track: TrackCache): GenerationState {
  return {
    recentTrackIds: pushCapped(state.recentTrackIds, track.navidromeSongId),
    recentArtistNames: pushCapped(state.recentArtistNames, track.artist),
    lastPlayedAt: new Date(),
    lastTrackId: track.navidromeSongId
  };
}

function mapTrackToClient(
  streamClient: Awaited<ReturnType<typeof getClientForUser>>,
  track: TrackCache
): Track {
  return {
    navidromeSongId: track.navidromeSongId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationSec: track.durationSec,
    artworkUrl: track.coverArtId ? streamClient.buildCoverArtUrl(track.coverArtId) : null,
    streamUrl: streamClient.buildStreamUrl(track.navidromeSongId),
    genre: track.genre,
    year: track.year
  };
}

export async function advanceNextTrack(stationId: string, userId: string): Promise<Track> {
  const context = await buildContext(userId, stationId);

  const pickedIds = new Set<string>();
  const selected = pickNextTrack(context, context.state, pickedIds);
  const nextState = advanceLocalState(context.state, selected);

  await prisma.stationState.upsert({
    where: { stationId: context.stationId },
    update: {
      lastPlayedAt: nextState.lastPlayedAt,
      lastTrackId: nextState.lastTrackId,
      recentTrackIdsJson: nextState.recentTrackIds,
      recentArtistNamesJson: nextState.recentArtistNames
    },
    create: {
      stationId: context.stationId,
      userId: context.userId,
      lastPlayedAt: nextState.lastPlayedAt,
      lastTrackId: nextState.lastTrackId,
      recentTrackIdsJson: nextState.recentTrackIds,
      recentArtistNamesJson: nextState.recentArtistNames
    }
  });

  await prisma.playEvent.create({
    data: {
      userId,
      stationId: context.stationId,
      navidromeSongId: selected.navidromeSongId,
      skipped: false,
      listenSeconds: 0
    }
  });

  return mapTrackToClient(context.streamClient, selected);
}

export async function peekNextTracks(stationId: string, userId: string, count: number): Promise<Track[]> {
  const context = await buildContext(userId, stationId);

  const tracks: Track[] = [];
  let simulatedState = { ...context.state };
  const pickedIds = new Set<string>();

  for (let i = 0; i < count; i += 1) {
    try {
      const selected = pickNextTrack(context, simulatedState, pickedIds);
      pickedIds.add(selected.navidromeSongId);
      simulatedState = advanceLocalState(simulatedState, selected);
      tracks.push(mapTrackToClient(context.streamClient, selected));
    } catch {
      break;
    }
  }

  return tracks;
}
