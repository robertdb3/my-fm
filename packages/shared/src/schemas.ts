import { z } from "zod";

export const StationRulesSchema = z.object({
  genresInclude: z.array(z.string().min(1)).default([]),
  genresExclude: z.array(z.string().min(1)).default([]),
  yearMin: z.number().int().min(1900).max(3000).optional(),
  yearMax: z.number().int().min(1900).max(3000).optional(),
  artistsInclude: z.array(z.string().min(1)).default([]),
  artistsExclude: z.array(z.string().min(1)).default([]),
  albumsInclude: z.array(z.string().min(1)).default([]),
  albumsExclude: z.array(z.string().min(1)).default([]),
  recentlyAddedDays: z.number().int().min(1).max(3650).optional(),
  minRating: z.number().min(0).max(5).optional(),
  durationMinSec: z.number().int().min(0).optional(),
  durationMaxSec: z.number().int().min(0).optional(),
  avoidRepeatHours: z.number().int().min(1).max(168).default(24),
  avoidSameArtistWithinTracks: z.number().int().min(1).max(50).default(3),
  preferLikedWeight: z.number().min(0).max(5).default(0.35),
  preferUnplayedWeight: z.number().min(0).max(5).default(0.7)
});

export const StationSchema = z.object({
  id: z.string().cuid(),
  userId: z.string().cuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  rules: StationRulesSchema,
  isEnabled: z.boolean(),
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

export const StationPlayResponseSchema = z.object({
  nowPlaying: TrackSchema,
  nextUp: z.array(TrackSchema),
  station: StationSchema
});

export const StationNextResponseSchema = z.object({
  track: TrackSchema
});

export const CreateStationSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  rules: StationRulesSchema,
  isEnabled: z.boolean().default(true)
});

export const UpdateStationSchema = CreateStationSchema.partial();

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
export type Station = z.infer<typeof StationSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type CreateStationInput = z.infer<typeof CreateStationSchema>;
export type UpdateStationInput = z.infer<typeof UpdateStationSchema>;
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type NavidromeConnectionInput = z.infer<typeof NavidromeConnectionInputSchema>;
export type NavidromeImportInput = z.infer<typeof NavidromeImportInputSchema>;
