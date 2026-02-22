import type { Prisma, Station as PrismaStation } from "@prisma/client";
import {
  CreateStationSchema,
  PatchStationSchema,
  StationRulesSchema,
  type PatchStationInput,
  type CreateStationInput,
  type Station,
  type TunerStation,
  type UpdateStationInput
} from "@music-cable-box/shared";
import { prisma } from "../db";
import { normalizeSortKey, systemTypeRank, tunerFrequencyLabel } from "./station-utils";

interface ListStationOptions {
  includeHidden?: boolean;
  includeSystem?: boolean;
}

function stationSortString(station: Pick<PrismaStation, "sortKey" | "name">): string {
  if (station.sortKey && station.sortKey.trim().length > 0) {
    return normalizeSortKey(station.sortKey);
  }

  return normalizeSortKey(station.name);
}

function compareStations(a: PrismaStation, b: PrismaStation): number {
  if (a.isHidden !== b.isHidden) {
    return a.isHidden ? 1 : -1;
  }

  if (a.isSystem !== b.isSystem) {
    return a.isSystem ? -1 : 1;
  }

  if (a.isSystem && b.isSystem) {
    const typeDiff = systemTypeRank(a.systemType) - systemTypeRank(b.systemType);
    if (typeDiff !== 0) {
      return typeDiff;
    }
  }

  const sortKeyDiff = stationSortString(a).localeCompare(stationSortString(b));
  if (sortKeyDiff !== 0) {
    return sortKeyDiff;
  }

  return a.name.localeCompare(b.name);
}

function toStation(station: PrismaStation): Station {
  return {
    id: station.id,
    userId: station.userId,
    name: station.name,
    description: station.description,
    rules: StationRulesSchema.parse(station.rulesJson),
    isEnabled: station.isEnabled,
    isSystem: station.isSystem,
    systemType: station.systemType,
    systemKey: station.systemKey,
    sortKey: station.sortKey,
    isHidden: station.isHidden,
    createdAt: station.createdAt.toISOString(),
    updatedAt: station.updatedAt.toISOString()
  };
}

async function findStations(userId: string, options: ListStationOptions = {}): Promise<PrismaStation[]> {
  return prisma.station.findMany({
    where: {
      userId,
      ...(options.includeHidden ? {} : { isHidden: false }),
      ...(options.includeSystem === false ? { isSystem: false } : {})
    }
  });
}

export async function listStations(userId: string, options: ListStationOptions = {}): Promise<Station[]> {
  const stations = await findStations(userId, options);
  stations.sort(compareStations);

  return stations.map(toStation);
}

export async function listTunerStations(userId: string): Promise<TunerStation[]> {
  const stations = await prisma.station.findMany({
    where: {
      userId,
      isHidden: false
    }
  });
  stations.sort(compareStations);

  return stations.map((station, tunerIndex) => ({
    id: station.id,
    name: station.name,
    isSystem: station.isSystem,
    systemType: station.systemType,
    systemKey: station.systemKey,
    isHidden: station.isHidden,
    isEnabled: station.isEnabled,
    sortKey: station.sortKey,
    tunerIndex,
    frequencyLabel: tunerFrequencyLabel(tunerIndex, stations.length)
  }));
}

export async function getStationById(userId: string, stationId: string): Promise<Station | null> {
  const station = await prisma.station.findFirst({
    where: {
      id: stationId,
      userId
    }
  });

  return station ? toStation(station) : null;
}

export async function createStation(userId: string, input: CreateStationInput): Promise<Station> {
  const payload = CreateStationSchema.parse(input);
  const sortKey = normalizeSortKey(payload.name);

  const station = await prisma.station.create({
    data: {
      userId,
      name: payload.name,
      description: payload.description ?? null,
      rulesJson: payload.rules,
      isEnabled: payload.isEnabled,
      isSystem: false,
      systemType: null,
      systemKey: null,
      sortKey,
      isHidden: false
    }
  });

  await prisma.stationState.upsert({
    where: { stationId: station.id },
    update: {},
    create: {
      stationId: station.id,
      userId,
      recentTrackIdsJson: [],
      recentArtistNamesJson: []
    }
  });

  return toStation(station);
}

export async function updateStation(
  userId: string,
  stationId: string,
  input: UpdateStationInput
): Promise<Station | null> {
  const existing = await prisma.station.findFirst({
    where: {
      id: stationId,
      userId
    }
  });

  if (!existing) {
    return null;
  }

  const updates: Prisma.StationUpdateInput = {};

  if (input.name !== undefined) {
    updates.name = input.name;
    updates.sortKey = normalizeSortKey(input.name);
  }

  if (input.description !== undefined) {
    updates.description = input.description ?? null;
  }

  if (input.rules !== undefined) {
    updates.rulesJson = StationRulesSchema.parse(input.rules);
  }

  if (input.isEnabled !== undefined) {
    updates.isEnabled = input.isEnabled;
  }

  const station = await prisma.station.update({
    where: { id: stationId },
    data: updates
  });

  return toStation(station);
}

export async function deleteStation(userId: string, stationId: string): Promise<boolean> {
  const existing = await prisma.station.findFirst({
    where: { id: stationId, userId },
    select: { id: true }
  });

  if (!existing) {
    return false;
  }

  await prisma.station.delete({ where: { id: stationId } });
  return true;
}

export async function patchStation(
  userId: string,
  stationId: string,
  input: PatchStationInput
): Promise<Station | null> {
  const payload = PatchStationSchema.parse(input);
  const existing = await prisma.station.findFirst({
    where: {
      id: stationId,
      userId
    }
  });

  if (!existing) {
    return null;
  }

  const updates: Prisma.StationUpdateInput = {};

  if (payload.isEnabled !== undefined) {
    updates.isEnabled = payload.isEnabled;
  }

  if (payload.isHidden !== undefined) {
    if (!existing.isSystem) {
      throw new Error("isHidden can only be toggled on system stations");
    }

    updates.isHidden = payload.isHidden;
  }

  const station = await prisma.station.update({
    where: { id: stationId },
    data: updates
  });

  return toStation(station);
}
