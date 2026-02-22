import type { Prisma, Station as PrismaStation } from "@prisma/client";
import {
  CreateStationSchema,
  StationRulesSchema,
  type CreateStationInput,
  type Station,
  type UpdateStationInput
} from "@music-cable-box/shared";
import { prisma } from "../db";

function toStation(station: PrismaStation): Station {
  return {
    id: station.id,
    userId: station.userId,
    name: station.name,
    description: station.description,
    rules: StationRulesSchema.parse(station.rulesJson),
    isEnabled: station.isEnabled,
    createdAt: station.createdAt.toISOString(),
    updatedAt: station.updatedAt.toISOString()
  };
}

export async function listStations(userId: string): Promise<Station[]> {
  const stations = await prisma.station.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" }
  });

  return stations.map(toStation);
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

  const station = await prisma.station.create({
    data: {
      userId,
      name: payload.name,
      description: payload.description ?? null,
      rulesJson: payload.rules,
      isEnabled: payload.isEnabled
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
