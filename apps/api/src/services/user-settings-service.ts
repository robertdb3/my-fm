import { AudioModeSchema, UpdateUserSettingsSchema, type UserSettings } from "@music-cable-box/shared";
import { prisma } from "../db";

function toSettingsResponse(record: { audioMode: string; updatedAt: Date }): UserSettings {
  return {
    audioMode: AudioModeSchema.parse(record.audioMode),
    updatedAt: record.updatedAt.toISOString()
  };
}

export async function getOrCreateUserSettings(userId: string): Promise<UserSettings> {
  const settings = await prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      audioMode: "UNMODIFIED"
    }
  });

  return toSettingsResponse(settings);
}

export async function updateUserSettings(userId: string, input: unknown): Promise<UserSettings> {
  const payload = UpdateUserSettingsSchema.parse(input);
  const settings = await prisma.userSettings.upsert({
    where: { userId },
    update: {
      ...(payload.audioMode !== undefined ? { audioMode: payload.audioMode } : {})
    },
    create: {
      userId,
      audioMode: payload.audioMode ?? "UNMODIFIED"
    }
  });

  return toSettingsResponse(settings);
}

export async function getUserAudioMode(userId: string) {
  const settings = await getOrCreateUserSettings(userId);
  return settings.audioMode;
}
