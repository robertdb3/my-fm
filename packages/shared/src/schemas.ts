import { z } from "zod";

const StringListSchema = z
  .array(z.string().min(1))
  .transform((items) => {
    const trimmed = items.map((item) => item.trim()).filter(Boolean);
    return Array.from(new Set(trimmed));
  });

const YearRangeSchema = z
  .object({
    min: z.number().int().min(1900).max(3000).optional(),
    max: z.number().int().min(1900).max(3000).optional()
  })
  .partial()
  .refine(
    (value) => value.min === undefined || value.max === undefined || value.min <= value.max,
    "yearRange.min must be <= yearRange.max"
  );

const DurationRangeSchema = z
  .object({
    minSec: z.number().int().min(0).optional(),
    maxSec: z.number().int().min(0).optional()
  })
  .partial()
  .refine(
    (value) => value.minSec === undefined || value.maxSec === undefined || value.minSec <= value.maxSec,
    "durationRange.minSec must be <= durationRange.maxSec"
  );

function normalizeLegacyStationRules(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const raw = input as Record<string, unknown>;

  const yearRange =
    raw.yearRange && typeof raw.yearRange === "object" && !Array.isArray(raw.yearRange)
      ? raw.yearRange
      : {
          min: raw.yearMin,
          max: raw.yearMax
        };

  const durationRange =
    raw.durationRange && typeof raw.durationRange === "object" && !Array.isArray(raw.durationRange)
      ? raw.durationRange
      : {
          minSec: raw.durationMinSec,
          maxSec: raw.durationMaxSec
        };

  return {
    includeGenres: raw.includeGenres ?? raw.genresInclude ?? [],
    excludeGenres: raw.excludeGenres ?? raw.genresExclude ?? [],
    includeArtists: raw.includeArtists ?? raw.artistsInclude ?? [],
    excludeArtists: raw.excludeArtists ?? raw.artistsExclude ?? [],
    includeAlbums: raw.includeAlbums ?? raw.albumsInclude ?? [],
    excludeAlbums: raw.excludeAlbums ?? raw.albumsExclude ?? [],
    yearRange,
    durationRange,
    recentlyAddedDays: raw.recentlyAddedDays,
    avoidRepeatHours: raw.avoidRepeatHours,
    artistSeparation: raw.artistSeparation ?? raw.avoidSameArtistWithinTracks,
    tuneInEnabled: raw.tuneInEnabled,
    tuneInMaxFraction: raw.tuneInMaxFraction,
    tuneInMinHeadSec: raw.tuneInMinHeadSec,
    tuneInMinTailSec: raw.tuneInMinTailSec,
    tuneInProbability: raw.tuneInProbability
  };
}

export const StationRulesSchema = z.preprocess(
  normalizeLegacyStationRules,
  z.object({
    includeGenres: StringListSchema.default([]),
    excludeGenres: StringListSchema.default([]),
    includeArtists: StringListSchema.default([]),
    excludeArtists: StringListSchema.default([]),
    includeAlbums: StringListSchema.default([]),
    excludeAlbums: StringListSchema.default([]),
    yearRange: YearRangeSchema.optional(),
    durationRange: DurationRangeSchema.optional(),
    recentlyAddedDays: z.number().int().min(1).max(3650).optional(),
    avoidRepeatHours: z.number().int().min(1).max(168).default(24),
    artistSeparation: z.number().int().min(1).max(50).default(3),
    tuneInEnabled: z.boolean().default(true),
    tuneInMaxFraction: z.number().min(0.05).max(0.95).default(0.6),
    tuneInMinHeadSec: z.number().int().min(0).max(600).default(8),
    tuneInMinTailSec: z.number().int().min(0).max(600).default(20),
    tuneInProbability: z.number().min(0).max(1).default(0.9)
  })
);

export function validateStationRules(input: unknown) {
  return StationRulesSchema.safeParse(input);
}

export function parseStationRules(input: unknown) {
  return StationRulesSchema.parse(input);
}

export const StationSystemTypeSchema = z.enum(["ARTIST", "GENRE", "DECADE"]);
export const AudioModeSchema = z.enum(["UNMODIFIED", "FM", "AM"]);

export const StationSchema = z.object({
  id: z.string().cuid(),
  userId: z.string().cuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  rules: StationRulesSchema,
  isEnabled: z.boolean(),
  isSystem: z.boolean(),
  systemType: StationSystemTypeSchema.nullable(),
  systemKey: z.string().nullable(),
  sortKey: z.string().nullable(),
  isHidden: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const TrackSchema = z.object({
  navidromeSongId: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  durationSec: z.number().int().nullable(),
  artworkUrl: z.string().url().nullable(),
  streamUrl: z.string().url(),
  genre: z.string().nullable().optional(),
  year: z.number().nullable().optional()
});

export const StationPlaybackSchema = z.object({
  startOffsetSec: z.number().int().min(0),
  reason: z.enum(["tune_in", "resume", "manual"])
});

export const NextPlaybackSchema = z.object({
  startOffsetSec: z.number().int().min(0),
  reason: z.literal("next")
});

export const StationPlayResponseSchema = z.object({
  nowPlaying: TrackSchema,
  nextUp: z.array(TrackSchema),
  station: StationSchema,
  playback: StationPlaybackSchema
});

export const StationNextResponseSchema = z.object({
  track: TrackSchema,
  playback: NextPlaybackSchema.optional()
});

export const CreateStationSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  rules: StationRulesSchema,
  isEnabled: z.boolean().default(true)
});

export const UpdateStationSchema = CreateStationSchema.partial();

export const PatchStationSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    isHidden: z.boolean().optional()
  })
  .refine((value) => value.isEnabled !== undefined || value.isHidden !== undefined, {
    message: "Provide at least one field to patch"
  });

export const SystemRegenerateInputSchema = z.object({
  types: z.array(StationSystemTypeSchema).min(1).optional(),
  minTracks: z
    .object({
      artist: z.number().int().min(1).max(10_000).optional(),
      genre: z.number().int().min(1).max(10_000).optional(),
      decade: z.number().int().min(1).max(10_000).optional()
    })
    .optional(),
  dryRun: z.boolean().default(false)
});

export const TunerStationSchema = z.object({
  id: z.string().cuid(),
  name: z.string(),
  isSystem: z.boolean(),
  systemType: StationSystemTypeSchema.nullable(),
  systemKey: z.string().nullable(),
  isHidden: z.boolean(),
  isEnabled: z.boolean(),
  tunerIndex: z.number().int().min(0),
  frequencyLabel: z.string(),
  sortKey: z.string().nullable()
});

export const TunerStationsResponseSchema = z.object({
  stations: z.array(TunerStationSchema)
});

export const TunerStepInputSchema = z.object({
  direction: z.enum(["NEXT", "PREV"]),
  fromStationId: z.string().cuid().optional(),
  wrap: z.boolean().default(true),
  play: z.boolean().default(true)
});

export const TunerStepResponseSchema = z.object({
  station: z.object({
    id: z.string().cuid(),
    name: z.string(),
    tunerIndex: z.number().int().min(0),
    frequencyLabel: z.string(),
    isSystem: z.boolean(),
    systemType: StationSystemTypeSchema.nullable(),
    systemKey: z.string().nullable()
  }),
  nowPlaying: TrackSchema.optional(),
  nextUp: z.array(TrackSchema).optional(),
  playback: StationPlaybackSchema.optional()
});

export const UserSettingsSchema = z.object({
  audioMode: AudioModeSchema,
  updatedAt: z.string().datetime()
});

export const UpdateUserSettingsSchema = z
  .object({
    audioMode: AudioModeSchema.optional()
  })
  .refine((value) => value.audioMode !== undefined, {
    message: "Provide at least one setting field"
  });

export const NavidromeConnectionInputSchema = z.object({
  baseUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1)
});

export const NavidromeImportInputSchema = z.object({
  fullResync: z.boolean().default(false),
  maxArtists: z.number().int().min(1).max(10000).default(10000)
});

export const FeedbackInputSchema = z.object({
  navidromeSongId: z.string(),
  liked: z.boolean().optional(),
  disliked: z.boolean().optional()
});

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional()
  })
});

export type StationRules = z.infer<typeof StationRulesSchema>;
export type StationSystemType = z.infer<typeof StationSystemTypeSchema>;
export type AudioMode = z.infer<typeof AudioModeSchema>;
export type Station = z.infer<typeof StationSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type CreateStationInput = z.infer<typeof CreateStationSchema>;
export type UpdateStationInput = z.infer<typeof UpdateStationSchema>;
export type PatchStationInput = z.infer<typeof PatchStationSchema>;
export type SystemRegenerateInput = z.infer<typeof SystemRegenerateInputSchema>;
export type TunerStation = z.infer<typeof TunerStationSchema>;
export type StationPlayback = z.infer<typeof StationPlaybackSchema>;
export type NextPlayback = z.infer<typeof NextPlaybackSchema>;
export type TunerStepInput = z.infer<typeof TunerStepInputSchema>;
export type TunerStepResponse = z.infer<typeof TunerStepResponseSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type UpdateUserSettingsInput = z.infer<typeof UpdateUserSettingsSchema>;
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type NavidromeConnectionInput = z.infer<typeof NavidromeConnectionInputSchema>;
export type NavidromeImportInput = z.infer<typeof NavidromeImportInputSchema>;
