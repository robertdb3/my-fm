import { describe, expect, it } from "vitest";
import { StationRulesSchema } from "@music-cable-box/shared";
import { scoreCandidate } from "../src/services/station-generator";

const baseRules = StationRulesSchema.parse({});

const trackTemplate = {
  id: "local-track",
  navidromeSongId: "song-1",
  title: "Song 1",
  artist: "The Artist",
  album: "Album",
  albumArtist: "The Artist",
  genre: "Rock",
  year: 2019,
  durationSec: 180,
  path: "/music/song.mp3",
  coverArtId: "cover-1",
  addedAt: new Date("2023-01-01T00:00:00.000Z"),
  createdAt: new Date("2023-01-01T00:00:00.000Z"),
  updatedAt: new Date("2023-01-01T00:00:00.000Z")
};

describe("station scoring", () => {
  it("prefers never-played and liked tracks over recently played/disliked", () => {
    const favored = scoreCandidate({
      track: {
        ...trackTemplate,
        navidromeSongId: "favored"
      },
      rules: baseRules,
      recentArtistWindow: [],
      lastPlayedAt: undefined,
      feedback: {
        liked: true,
        disliked: false
      },
      seedSalt: "fixed-seed"
    });

    const unfavored = scoreCandidate({
      track: {
        ...trackTemplate,
        navidromeSongId: "unfavored"
      },
      rules: baseRules,
      recentArtistWindow: [],
      lastPlayedAt: new Date(),
      feedback: {
        liked: false,
        disliked: true
      },
      seedSalt: "fixed-seed"
    });

    expect(favored).toBeGreaterThan(unfavored);
  });

  it("penalizes tracks when the artist appears in the recent artist window", () => {
    const noPenalty = scoreCandidate({
      track: {
        ...trackTemplate,
        navidromeSongId: "no-penalty",
        artist: "Unique Artist"
      },
      rules: baseRules,
      recentArtistWindow: ["other artist"],
      lastPlayedAt: undefined,
      seedSalt: "fixed-seed"
    });

    const penalized = scoreCandidate({
      track: {
        ...trackTemplate,
        navidromeSongId: "penalized",
        artist: "Duplicate Artist"
      },
      rules: baseRules,
      recentArtistWindow: ["duplicate artist"],
      lastPlayedAt: undefined,
      seedSalt: "fixed-seed"
    });

    expect(noPenalty).toBeGreaterThan(penalized);
  });
});
