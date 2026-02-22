import type { Prisma, Station as PrismaStation } from "@prisma/client";
import {
  StationRulesSchema,
  type StationRules,
  type StationSystemType,
  type SystemRegenerateInput
} from "@music-cable-box/shared";
import { prisma } from "../db";
import { normalizeSortKey, toDecadeLabel, toDecadeStart, toOptionalNormalizedDisplay } from "./station-utils";

const DEFAULT_MIN_TRACKS = {
  artist: 15,
  genre: 30,
  decade: 50
} as const;

const ALL_SYSTEM_TYPES: StationSystemType[] = ["ARTIST", "GENRE", "DECADE"];

interface NormalizedGroupInput {
  value: string | null;
  count: number;
}

interface GroupCandidate {
  key: string;
  display: string;
  count: number;
}

interface GeneratedSystemStation {
  systemType: StationSystemType;
  systemKey: string;
  sortKey: string;
  name: string;
  description: string;
  rules: StationRules;
}

interface DecadeBucket {
  decadeStart: number;
  label: string;
  count: number;
}

type RegenerateAction = "created" | "updated" | "skipped" | "hidden";

export interface RegenerateSystemStationsResult {
  created: number;
  updated: number;
  skipped: number;
  disabledOrHidden: number;
  sample: Array<{
    type: StationSystemType;
    key: string;
    action: RegenerateAction;
  }>;
}

function toStationIdentity(type: StationSystemType, systemKey: string): string {
  return `${type}:${normalizeSortKey(systemKey)}`;
}

function uniqueTypes(input?: StationSystemType[]): StationSystemType[] {
  if (!input || input.length === 0) {
    return [...ALL_SYSTEM_TYPES];
  }

  return Array.from(new Set(input));
}

function normalizeGroups(inputs: NormalizedGroupInput[]): GroupCandidate[] {
  const byKey = new Map<string, GroupCandidate>();

  for (const input of inputs) {
    const display = toOptionalNormalizedDisplay(input.value);
    if (!display) {
      continue;
    }

    const key = normalizeSortKey(display);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        key,
        display,
        count: input.count
      });
      continue;
    }

    existing.count += input.count;
    if (display.localeCompare(existing.display) < 0) {
      existing.display = display;
    }
  }

  return [...byKey.values()];
}

async function buildArtistStations(minTracks: number): Promise<GeneratedSystemStation[]> {
  const grouped = await prisma.trackCache.groupBy({
    by: ["artist"],
    where: {
      artist: {
        not: ""
      }
    },
    _count: {
      artist: true
    }
  });

  const normalized = normalizeGroups(
    grouped.map((row) => ({
      value: row.artist,
      count: row._count.artist
    }))
  );

  return normalized
    .filter((group) => group.count >= minTracks)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((group) => ({
      systemType: "ARTIST",
      systemKey: group.display,
      sortKey: group.key,
      name: `Artist Radio: ${group.display}`,
      description: "Auto-generated artist station based on your library metadata.",
      rules: StationRulesSchema.parse({
        includeArtists: [group.display]
      })
    }));
}

async function buildGenreStations(minTracks: number): Promise<GeneratedSystemStation[]> {
  const grouped = await prisma.trackCache.groupBy({
    by: ["genre"],
    where: {
      genre: {
        not: null
      },
      NOT: {
        genre: ""
      }
    },
    _count: {
      genre: true
    }
  });

  const normalized = normalizeGroups(
    grouped.map((row) => ({
      value: row.genre,
      count: row._count.genre
    }))
  );

  return normalized
    .filter((group) => group.count >= minTracks)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((group) => ({
      systemType: "GENRE",
      systemKey: group.display,
      sortKey: group.key,
      name: `Genre Radio: ${group.display}`,
      description: "Auto-generated genre station based on your library metadata.",
      rules: StationRulesSchema.parse({
        includeGenres: [group.display]
      })
    }));
}

export function buildDecadeBucketsFromYearCounts(
  yearCounts: Array<{ year: number; count: number }>,
  minTracks: number,
  currentYear: number
): DecadeBucket[] {
  const byDecade = new Map<number, number>();

  for (const { year, count } of yearCounts) {
    const decadeStart = toDecadeStart(year, currentYear);
    if (decadeStart === null) {
      continue;
    }

    byDecade.set(decadeStart, (byDecade.get(decadeStart) ?? 0) + count);
  }

  return [...byDecade.entries()]
    .map(([decadeStart, count]) => ({
      decadeStart,
      label: toDecadeLabel(decadeStart),
      count
    }))
    .filter((entry) => entry.count >= minTracks)
    .sort((a, b) => a.decadeStart - b.decadeStart);
}

async function buildDecadeStations(minTracks: number, currentYear: number): Promise<GeneratedSystemStation[]> {
  const grouped = await prisma.trackCache.groupBy({
    by: ["year"],
    where: {
      year: {
        gte: 1900,
        lte: currentYear
      }
    },
    _count: {
      year: true
    }
  });

  const buckets = buildDecadeBucketsFromYearCounts(
    grouped
      .map((row) => ({
        year: row.year,
        count: row._count.year
      }))
      .filter((row): row is { year: number; count: number } => row.year !== null),
    minTracks,
    currentYear
  );

  return buckets.map((bucket) => ({
    systemType: "DECADE",
    systemKey: bucket.label,
    sortKey: bucket.decadeStart.toString(),
    name: `${bucket.label} Radio`,
    description: "Auto-generated decade station based on your library metadata.",
    rules: StationRulesSchema.parse({
      yearRange: {
        min: bucket.decadeStart,
        max: bucket.decadeStart + 9
      }
    })
  }));
}

function hasStationChanged(existing: PrismaStation, next: GeneratedSystemStation): boolean {
  const existingRules = StationRulesSchema.parse(existing.rulesJson);

  return (
    existing.name !== next.name ||
    existing.description !== next.description ||
    existing.sortKey !== next.sortKey ||
    existing.systemType !== next.systemType ||
    existing.systemKey !== next.systemKey ||
    JSON.stringify(existingRules) !== JSON.stringify(next.rules)
  );
}

async function ensureStationState(stationId: string, userId: string) {
  await prisma.stationState.upsert({
    where: { stationId },
    update: {},
    create: {
      stationId,
      userId,
      recentTrackIdsJson: [],
      recentArtistNamesJson: []
    }
  });
}

function pushSample(
  sample: RegenerateSystemStationsResult["sample"],
  type: StationSystemType,
  key: string,
  action: RegenerateAction
) {
  if (sample.length >= 50) {
    return;
  }

  sample.push({
    type,
    key,
    action
  });
}

export async function regenerateSystemStations(
  userId: string,
  input: SystemRegenerateInput
): Promise<RegenerateSystemStationsResult> {
  const types = uniqueTypes(input.types);
  const minTracks = {
    artist: input.minTracks?.artist ?? DEFAULT_MIN_TRACKS.artist,
    genre: input.minTracks?.genre ?? DEFAULT_MIN_TRACKS.genre,
    decade: input.minTracks?.decade ?? DEFAULT_MIN_TRACKS.decade
  };
  const dryRun = input.dryRun ?? false;
  const currentYear = new Date().getUTCFullYear();

  const generatedByType = await Promise.all(
    types.map(async (type) => {
      if (type === "ARTIST") {
        return buildArtistStations(minTracks.artist);
      }

      if (type === "GENRE") {
        return buildGenreStations(minTracks.genre);
      }

      return buildDecadeStations(minTracks.decade, currentYear);
    })
  );

  const generated = generatedByType.flat();
  const generatedIdentitySet = new Set(generated.map((item) => toStationIdentity(item.systemType, item.systemKey)));

  const existingSystemStations = await prisma.station.findMany({
    where: {
      userId,
      isSystem: true,
      systemType: {
        in: types
      }
    }
  });

  const existingByIdentity = new Map<string, PrismaStation>();
  for (const station of existingSystemStations) {
    if (!station.systemType || !station.systemKey) {
      continue;
    }

    existingByIdentity.set(toStationIdentity(station.systemType, station.systemKey), station);
  }

  const result: RegenerateSystemStationsResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    disabledOrHidden: 0,
    sample: []
  };

  if (!dryRun) {
    for (const generatedStation of generated) {
      const identity = toStationIdentity(generatedStation.systemType, generatedStation.systemKey);
      const existing = existingByIdentity.get(identity);

      if (!existing) {
        const created = await prisma.station.create({
          data: {
            userId,
            name: generatedStation.name,
            description: generatedStation.description,
            rulesJson: generatedStation.rules as Prisma.InputJsonValue,
            isEnabled: true,
            isSystem: true,
            systemType: generatedStation.systemType,
            systemKey: generatedStation.systemKey,
            sortKey: generatedStation.sortKey
          }
        });

        await ensureStationState(created.id, userId);

        result.created += 1;
        pushSample(result.sample, generatedStation.systemType, generatedStation.systemKey, "created");
        continue;
      }

      if (!hasStationChanged(existing, generatedStation)) {
        result.skipped += 1;
        pushSample(result.sample, generatedStation.systemType, generatedStation.systemKey, "skipped");
        continue;
      }

      await prisma.station.update({
        where: { id: existing.id },
        data: {
          name: generatedStation.name,
          description: generatedStation.description,
          rulesJson: generatedStation.rules as Prisma.InputJsonValue,
          isSystem: true,
          systemType: generatedStation.systemType,
          systemKey: generatedStation.systemKey,
          sortKey: generatedStation.sortKey
        }
      });

      result.updated += 1;
      pushSample(result.sample, generatedStation.systemType, generatedStation.systemKey, "updated");
    }
  } else {
    for (const generatedStation of generated) {
      const identity = toStationIdentity(generatedStation.systemType, generatedStation.systemKey);
      const existing = existingByIdentity.get(identity);

      if (!existing) {
        result.created += 1;
        pushSample(result.sample, generatedStation.systemType, generatedStation.systemKey, "created");
        continue;
      }

      if (!hasStationChanged(existing, generatedStation)) {
        result.skipped += 1;
        pushSample(result.sample, generatedStation.systemType, generatedStation.systemKey, "skipped");
        continue;
      }

      result.updated += 1;
      pushSample(result.sample, generatedStation.systemType, generatedStation.systemKey, "updated");
    }
  }

  const staleStations = existingSystemStations.filter((station) => {
    if (!station.systemType || !station.systemKey) {
      return false;
    }

    return !generatedIdentitySet.has(toStationIdentity(station.systemType, station.systemKey));
  });

  for (const station of staleStations) {
    if (station.isHidden) {
      result.skipped += 1;
      continue;
    }

    if (!dryRun) {
      await prisma.station.update({
        where: {
          id: station.id
        },
        data: {
          isHidden: true
        }
      });
    }

    result.disabledOrHidden += 1;
    pushSample(result.sample, station.systemType ?? "ARTIST", station.systemKey ?? station.id, "hidden");
  }

  return result;
}
