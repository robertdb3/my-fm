import type { Prisma, TrackCache } from "@prisma/client";
import { StationRulesSchema, type StationRules, type Track } from "@music-cable-box/shared";
import { prisma } from "../db";
import { getClientForUser } from "./library-import-service";

const HOUR_MS = 60 * 60 * 1000;
const STATE_CAP = 200;
const CANDIDATE_POOL_SIZE = 900;
const WEIGHTED_TOP_K = 200;
const CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 200;

const LIKE_BOOST = 0.5;
const DISLIKE_PENALTY = 1.0;
const ARTIST_REPETITION_PENALTY = 0.65;
const RECENCY_HALF_LIFE_HOURS = 36;

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
  now: Date;
  state: GenerationState;
  streamClient: Awaited<ReturnType<typeof getClientForUser>>;
  candidatePool: TrackCache[];
  recentPlayedTrackIds: Set<string>;
  lastPlayedMap: Map<string, Date>;
  feedbackMap: Map<string, { liked: boolean; disliked: boolean }>;
}

interface CandidateCacheEntry {
  tracks: TrackCache[];
  expiresAt: number;
}

interface ScoredCandidate {
  track: TrackCache;
  score: number;
}

export interface GeneratorOptions {
  seed?: string;
  now?: Date;
}

export interface ExclusionResult {
  tracks: TrackCache[];
  relaxedTrackExclusion: boolean;
  relaxedArtistExclusion: boolean;
}

const candidateCache = new Map<string, CandidateCacheEntry>();

function lower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeRuleList(input: string[]): string[] {
  return Array.from(
    new Set(
      input
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
}

function hashToUint32(seed: string): number {
  let hash = 2166136261;

  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededUnit(seed: string): number {
  return hashToUint32(seed) / 4294967295;
}

function createSeededRng(seed: string): () => number {
  let state = hashToUint32(seed) || 1;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function trackBaseRandom(trackId: string, seed?: string): number {
  if (!seed) {
    return Math.random();
  }

  return seededUnit(`${seed}:track:${trackId}`);
}

function getRecencyCutoff(avoidRepeatHours: number, now: Date): Date {
  return new Date(now.getTime() - avoidRepeatHours * HOUR_MS);
}

export function buildCandidateFilter(rules: StationRules, now: Date): Prisma.TrackCacheWhereInput {
  const andClauses: Prisma.TrackCacheWhereInput[] = [];

  const genresInclude = normalizeRuleList(rules.includeGenres);
  const genresExclude = normalizeRuleList(rules.excludeGenres);
  const artistsInclude = normalizeRuleList(rules.includeArtists);
  const artistsExclude = normalizeRuleList(rules.excludeArtists);
  const albumsInclude = normalizeRuleList(rules.includeAlbums);
  const albumsExclude = normalizeRuleList(rules.excludeAlbums);

  if (genresInclude.length > 0) {
    andClauses.push({ genre: { in: genresInclude } });
  }

  if (genresExclude.length > 0) {
    andClauses.push({ NOT: { genre: { in: genresExclude } } });
  }

  if (artistsInclude.length > 0) {
    andClauses.push({ artist: { in: artistsInclude } });
  }

  if (artistsExclude.length > 0) {
    andClauses.push({ NOT: { artist: { in: artistsExclude } } });
  }

  if (albumsInclude.length > 0) {
    andClauses.push({ album: { in: albumsInclude } });
  }

  if (albumsExclude.length > 0) {
    andClauses.push({ NOT: { album: { in: albumsExclude } } });
  }

  if (rules.yearRange?.min !== undefined || rules.yearRange?.max !== undefined) {
    andClauses.push({
      year: {
        ...(rules.yearRange?.min !== undefined ? { gte: rules.yearRange.min } : {}),
        ...(rules.yearRange?.max !== undefined ? { lte: rules.yearRange.max } : {})
      }
    });
  }

  if (rules.durationRange?.minSec !== undefined || rules.durationRange?.maxSec !== undefined) {
    andClauses.push({
      durationSec: {
        ...(rules.durationRange?.minSec !== undefined ? { gte: rules.durationRange.minSec } : {}),
        ...(rules.durationRange?.maxSec !== undefined ? { lte: rules.durationRange.maxSec } : {})
      }
    });
  }

  if (rules.recentlyAddedDays !== undefined) {
    andClauses.push({
      addedAt: {
        gte: new Date(now.getTime() - rules.recentlyAddedDays * 24 * HOUR_MS)
      }
    });
  }

  if (andClauses.length === 0) {
    return {};
  }

  return { AND: andClauses };
}

export async function getStationPreviewCount(rules: StationRules, now = new Date()): Promise<number> {
  const where = buildCandidateFilter(rules, now);
  return prisma.trackCache.count({ where });
}

function buildFilterSignature(rules: StationRules, now: Date): string {
  const hourBucket = Math.floor(now.getTime() / HOUR_MS);

  return JSON.stringify({
    includeGenres: [...normalizeRuleList(rules.includeGenres)].sort(),
    excludeGenres: [...normalizeRuleList(rules.excludeGenres)].sort(),
    includeArtists: [...normalizeRuleList(rules.includeArtists)].sort(),
    excludeArtists: [...normalizeRuleList(rules.excludeArtists)].sort(),
    includeAlbums: [...normalizeRuleList(rules.includeAlbums)].sort(),
    excludeAlbums: [...normalizeRuleList(rules.excludeAlbums)].sort(),
    yearRange: rules.yearRange ?? null,
    durationRange: rules.durationRange ?? null,
    recentlyAddedDays: rules.recentlyAddedDays,
    recentlyAddedBucket: rules.recentlyAddedDays !== undefined ? hourBucket : null
  });
}

function makeCacheKey(
  userId: string,
  stationId: string,
  filterSignature: string,
  seed: string | undefined
): string {
  if (seed) {
    return `${userId}:${stationId}:${filterSignature}:seed:${seed}`;
  }

  return `${userId}:${stationId}:${filterSignature}`;
}

function pruneCandidateCache(nowMs: number) {
  for (const [key, entry] of candidateCache.entries()) {
    if (entry.expiresAt <= nowMs) {
      candidateCache.delete(key);
    }
  }

  while (candidateCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = candidateCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }

    candidateCache.delete(oldestKey);
  }
}

async function loadCandidatePool(params: {
  userId: string;
  stationId: string;
  rules: StationRules;
  now: Date;
  seed?: string;
}): Promise<TrackCache[]> {
  const { userId, stationId, rules, now, seed } = params;
  const where = buildCandidateFilter(rules, now);
  const filterSignature = buildFilterSignature(rules, now);
  const cacheKey = makeCacheKey(userId, stationId, filterSignature, seed);
  const nowMs = now.getTime();

  pruneCandidateCache(nowMs);

  const cached = candidateCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    return cached.tracks;
  }

  const totalMatches = await prisma.trackCache.count({ where });

  if (totalMatches === 0) {
    return [];
  }

  const take = Math.min(CANDIDATE_POOL_SIZE, totalMatches);
  const maxOffset = Math.max(0, totalMatches - take);
  const randomUnit = seed ? createSeededRng(`${seed}:${stationId}:${totalMatches}`)() : Math.random();
  const offset = maxOffset === 0 ? 0 : Math.floor(randomUnit * maxOffset);

  const primary = await prisma.trackCache.findMany({
    where,
    orderBy: {
      navidromeSongId: "asc"
    },
    skip: offset,
    take
  });

  let tracks = primary;

  if (tracks.length < take) {
    const remaining = take - tracks.length;
    const overflow = await prisma.trackCache.findMany({
      where,
      orderBy: {
        navidromeSongId: "asc"
      },
      take: remaining
    });

    const seen = new Set(tracks.map((track) => track.navidromeSongId));
    tracks = [
      ...tracks,
      ...overflow.filter((track) => {
        if (seen.has(track.navidromeSongId)) {
          return false;
        }

        seen.add(track.navidromeSongId);
        return true;
      })
    ];
  }

  candidateCache.set(cacheKey, {
    tracks,
    expiresAt: nowMs + CACHE_TTL_MS
  });

  return tracks;
}

export function computeRecencyBoost(lastPlayedAt: Date | undefined, now: Date): number {
  if (!lastPlayedAt) {
    return 1;
  }

  const elapsedHours = Math.max(0, (now.getTime() - lastPlayedAt.getTime()) / HOUR_MS);
  return 1 - Math.exp(-elapsedHours / RECENCY_HALF_LIFE_HOURS);
}

export function applyCandidateExclusions(params: {
  candidates: TrackCache[];
  disallowedTrackIds: Set<string>;
  recentArtistNames: string[];
  artistSeparation: number;
}): ExclusionResult {
  const { candidates, disallowedTrackIds, recentArtistNames, artistSeparation } = params;

  const artistWindow = new Set(
    recentArtistNames.slice(-artistSeparation).map((artistName) => lower(artistName))
  );

  const trackFiltered = candidates.filter((track) => !disallowedTrackIds.has(track.navidromeSongId));
  const trackAndArtistFiltered = trackFiltered.filter(
    (track) => !artistWindow.has(lower(track.artist))
  );

  if (trackAndArtistFiltered.length > 0) {
    return {
      tracks: trackAndArtistFiltered,
      relaxedTrackExclusion: false,
      relaxedArtistExclusion: false
    };
  }

  if (trackFiltered.length > 0) {
    // Keep repeat protection strict when possible; relax artist separation only as fallback.
    return {
      tracks: trackFiltered,
      relaxedTrackExclusion: false,
      relaxedArtistExclusion: true
    };
  }

  const artistOnlyFiltered = candidates.filter((track) => !artistWindow.has(lower(track.artist)));

  if (artistOnlyFiltered.length > 0) {
    // If repeat filtering empties the pool, keep station playback alive by relaxing repeat exclusion.
    return {
      tracks: artistOnlyFiltered,
      relaxedTrackExclusion: true,
      relaxedArtistExclusion: false
    };
  }

  return {
    tracks: candidates,
    relaxedTrackExclusion: true,
    relaxedArtistExclusion: true
  };
}

export function scoreCandidate(params: {
  track: TrackCache;
  lastPlayedAt: Date | undefined;
  feedback?: { liked: boolean; disliked: boolean };
  recentArtistNames: string[];
  artistSeparation: number;
  now: Date;
  seed?: string;
}) {
  const { track, lastPlayedAt, feedback, recentArtistNames, artistSeparation, now, seed } = params;

  const recentArtists = new Set(
    recentArtistNames.slice(-artistSeparation).map((artistName) => lower(artistName))
  );

  const baseRandom = trackBaseRandom(track.navidromeSongId, seed);
  const recencyBoost = computeRecencyBoost(lastPlayedAt, now);
  const likeBoost = feedback?.liked ? LIKE_BOOST : 0;
  const dislikePenalty = feedback?.disliked ? DISLIKE_PENALTY : 0;
  const artistRepetitionPenalty = recentArtists.has(lower(track.artist))
    ? ARTIST_REPETITION_PENALTY
    : 0;

  return baseRandom + recencyBoost + likeBoost - dislikePenalty - artistRepetitionPenalty;
}

function weightedSampleTopK(scoredCandidates: ScoredCandidate[], topK: number, seed?: string) {
  const topCandidates = [...scoredCandidates].sort((a, b) => b.score - a.score).slice(0, topK);

  if (topCandidates.length === 0) {
    return null;
  }

  const minScore = Math.min(...topCandidates.map((candidate) => candidate.score));
  const weighted = topCandidates.map((candidate) => ({
    ...candidate,
    weight: Math.max(0.001, candidate.score - minScore + 0.001)
  }));

  const totalWeight = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  const random = seed ? createSeededRng(`${seed}:pick`)() : Math.random();
  let threshold = random * totalWeight;

  for (const candidate of weighted) {
    threshold -= candidate.weight;
    if (threshold <= 0) {
      return candidate.track;
    }
  }

  return weighted[weighted.length - 1]?.track ?? null;
}

function pushCapped(list: string[], value: string) {
  const next = [...list, value];
  if (next.length > STATE_CAP) {
    next.shift();
  }

  return next;
}

function advanceLocalState(state: GenerationState, track: TrackCache, playedAt: Date): GenerationState {
  return {
    recentTrackIds: pushCapped(state.recentTrackIds, track.navidromeSongId),
    recentArtistNames: pushCapped(state.recentArtistNames, track.artist),
    lastPlayedAt: playedAt,
    lastTrackId: track.navidromeSongId
  };
}

async function buildContext(
  userId: string,
  stationId: string,
  options: GeneratorOptions
): Promise<GenerationContext> {
  const now = options.now ?? new Date();
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

  let candidatePool = await loadCandidatePool({
    userId,
    stationId: station.id,
    rules,
    now,
    seed: options.seed
  });

  if (candidatePool.length === 0) {
    throw new Error("No tracks match this station configuration");
  }

  const candidateIds = candidatePool.map((track) => track.navidromeSongId);
  const avoidRepeatCutoff = getRecencyCutoff(rules.avoidRepeatHours, now);

  const [recentPlayRows, lastPlayedRows, feedbackRows] = await Promise.all([
    prisma.playEvent.groupBy({
      by: ["navidromeSongId"],
      where: {
        userId,
        navidromeSongId: { in: candidateIds },
        playedAt: { gte: avoidRepeatCutoff }
      },
      _max: {
        playedAt: true
      }
    }),
    prisma.playEvent.groupBy({
      by: ["navidromeSongId"],
      where: {
        userId,
        navidromeSongId: { in: candidateIds }
      },
      _max: {
        playedAt: true
      }
    }),
    prisma.trackFeedback.findMany({
      where: {
        userId,
        navidromeSongId: { in: candidateIds }
      },
      select: {
        navidromeSongId: true,
        liked: true,
        disliked: true
      }
    })
  ]);

  const recentPlayedTrackIds = new Set(recentPlayRows.map((row) => row.navidromeSongId));

  const lastPlayedMap = new Map<string, Date>();
  for (const row of lastPlayedRows) {
    if (row._max.playedAt) {
      lastPlayedMap.set(row.navidromeSongId, row._max.playedAt);
    }
  }

  const feedbackMap = new Map<string, { liked: boolean; disliked: boolean }>();
  for (const row of feedbackRows) {
    feedbackMap.set(row.navidromeSongId, {
      liked: row.liked,
      disliked: row.disliked
    });
  }

  if (candidatePool.length === 0) {
    throw new Error("No tracks match this station configuration");
  }

  return {
    stationId: station.id,
    userId,
    rules,
    now,
    state,
    streamClient,
    candidatePool,
    recentPlayedTrackIds,
    lastPlayedMap,
    feedbackMap
  };
}

function pickNextTrack(params: {
  context: GenerationContext;
  state: GenerationState;
  pickedIds: Set<string>;
  step: number;
  seed?: string;
}): TrackCache {
  const { context, state, pickedIds, step, seed } = params;

  const disallowedTrackIds = new Set<string>([
    ...context.recentPlayedTrackIds,
    ...state.recentTrackIds,
    ...pickedIds
  ]);

  const candidateSubset = context.candidatePool.filter((track) => !pickedIds.has(track.navidromeSongId));

  const exclusionResult = applyCandidateExclusions({
    candidates: candidateSubset,
    disallowedTrackIds,
    recentArtistNames: state.recentArtistNames,
    artistSeparation: context.rules.artistSeparation
  });

  if (exclusionResult.tracks.length === 0) {
    throw new Error("No candidates available for this station");
  }

  const scoreSeed = seed ? `${seed}:${context.stationId}:${step}` : undefined;

  const scored = exclusionResult.tracks.map((track) => ({
    track,
    score: scoreCandidate({
      track,
      lastPlayedAt: context.lastPlayedMap.get(track.navidromeSongId),
      feedback: context.feedbackMap.get(track.navidromeSongId),
      recentArtistNames: state.recentArtistNames,
      artistSeparation: context.rules.artistSeparation,
      now: context.now,
      seed: scoreSeed
    })
  }));

  const selected = weightedSampleTopK(scored, WEIGHTED_TOP_K, scoreSeed);

  if (!selected) {
    throw new Error("Unable to sample a track from station candidates");
  }

  return selected;
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

export async function advanceNextTrack(
  stationId: string,
  userId: string,
  options: GeneratorOptions = {}
): Promise<Track> {
  const context = await buildContext(userId, stationId, options);

  const selected = pickNextTrack({
    context,
    state: context.state,
    pickedIds: new Set<string>(),
    step: 0,
    seed: options.seed
  });

  const playedAt = options.now ?? new Date();
  const nextState = advanceLocalState(context.state, selected, playedAt);

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
      playedAt,
      skipped: false,
      listenSeconds: 0
    }
  });

  return mapTrackToClient(context.streamClient, selected);
}

export async function peekNextTracks(
  stationId: string,
  userId: string,
  count: number,
  options: GeneratorOptions = {}
): Promise<Track[]> {
  const context = await buildContext(userId, stationId, options);

  const tracks: Track[] = [];
  let simulatedState: GenerationState = {
    ...context.state,
    recentTrackIds: [...context.state.recentTrackIds],
    recentArtistNames: [...context.state.recentArtistNames]
  };
  const pickedIds = new Set<string>();

  for (let step = 0; step < count; step += 1) {
    try {
      const selected = pickNextTrack({
        context,
        state: simulatedState,
        pickedIds,
        step,
        seed: options.seed
      });

      pickedIds.add(selected.navidromeSongId);
      simulatedState = advanceLocalState(simulatedState, selected, context.now);
      tracks.push(mapTrackToClient(context.streamClient, selected));
    } catch {
      break;
    }
  }

  return tracks;
}

export function __resetCandidateCacheForTests() {
  candidateCache.clear();
}
