import { describe, expect, it } from "vitest";
import {
  applyCandidateExclusions,
  computeRecencyBoost,
  scoreCandidate
} from "../src/services/station-generator";

const now = new Date("2026-02-22T12:00:00.000Z");

function buildTrack(input: {
  navidromeSongId: string;
  artist: string;
}) {
  return {
    id: `local-${input.navidromeSongId}`,
    navidromeSongId: input.navidromeSongId,
    title: `Title ${input.navidromeSongId}`,
    artist: input.artist,
    album: "Album",
    albumArtist: input.artist,
    genre: "Rock",
    year: 2020,
    durationSec: 180,
    path: `/music/${input.navidromeSongId}.mp3`,
    coverArtId: null,
    addedAt: new Date("2024-01-01T00:00:00.000Z"),
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z")
  };
}

describe("station scoring", () => {
  it("increases recency boost as last-played moves further into the past", () => {
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const boostRecent = computeRecencyBoost(oneHourAgo, now);
    const boostOld = computeRecencyBoost(sevenDaysAgo, now);

    expect(boostOld).toBeGreaterThan(boostRecent);
  });

  it("applies like/dislike and artist repetition weighting", () => {
    const track = buildTrack({ navidromeSongId: "seeded-a", artist: "Artist A" });

    const likedScore = scoreCandidate({
      track,
      lastPlayedAt: undefined,
      feedback: { liked: true, disliked: false },
      recentArtistNames: [],
      artistSeparation: 3,
      now,
      seed: "fixed"
    });

    const dislikedAndRepeatedScore = scoreCandidate({
      track,
      lastPlayedAt: undefined,
      feedback: { liked: false, disliked: true },
      recentArtistNames: ["Artist A"],
      artistSeparation: 3,
      now,
      seed: "fixed"
    });

    expect(likedScore).toBeGreaterThan(dislikedAndRepeatedScore);
  });
});

describe("candidate exclusions", () => {
  it("excludes disallowed tracks and recently repeated artists when alternatives exist", () => {
    const candidates = [
      buildTrack({ navidromeSongId: "t1", artist: "Artist A" }),
      buildTrack({ navidromeSongId: "t2", artist: "Artist B" }),
      buildTrack({ navidromeSongId: "t3", artist: "Artist C" })
    ];

    const result = applyCandidateExclusions({
      candidates,
      disallowedTrackIds: new Set(["t2"]),
      recentArtistNames: ["Artist A"],
      artistSeparation: 3
    });

    expect(result.relaxedTrackExclusion).toBe(false);
    expect(result.relaxedArtistExclusion).toBe(false);
    expect(result.tracks.map((track) => track.navidromeSongId)).toEqual(["t3"]);
  });

  it("relaxes artist exclusion only when strict artist separation would empty the pool", () => {
    const candidates = [
      buildTrack({ navidromeSongId: "t1", artist: "Artist A" }),
      buildTrack({ navidromeSongId: "t2", artist: "Artist A" })
    ];

    const result = applyCandidateExclusions({
      candidates,
      disallowedTrackIds: new Set(),
      recentArtistNames: ["Artist A"],
      artistSeparation: 3
    });

    expect(result.relaxedTrackExclusion).toBe(false);
    expect(result.relaxedArtistExclusion).toBe(true);
    expect(result.tracks).toHaveLength(2);
  });
});
