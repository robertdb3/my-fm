"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Station, StationRules, Track } from "@music-cable-box/shared";
import {
  ApiRequestError,
  createStationApi,
  deleteStationApi,
  getStations,
  nextStationTrack,
  peekStation,
  saveFeedback,
  startStation,
  updateStationApi
} from "../../src/lib/api";
import { useRequireAuth } from "../../src/lib/useRequireAuth";

function splitCsv(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

interface RuleFormState {
  name: string;
  description: string;
  genresInclude: string;
  genresExclude: string;
  artistsInclude: string;
  artistsExclude: string;
  albumsInclude: string;
  albumsExclude: string;
  yearMin: string;
  yearMax: string;
  recentlyAddedDays: string;
  durationMinSec: string;
  durationMaxSec: string;
  avoidRepeatHours: string;
  avoidSameArtistWithinTracks: string;
  preferLikedWeight: string;
  preferUnplayedWeight: string;
  isEnabled: boolean;
}

const defaultFormState: RuleFormState = {
  name: "",
  description: "",
  genresInclude: "",
  genresExclude: "",
  artistsInclude: "",
  artistsExclude: "",
  albumsInclude: "",
  albumsExclude: "",
  yearMin: "",
  yearMax: "",
  recentlyAddedDays: "",
  durationMinSec: "",
  durationMaxSec: "",
  avoidRepeatHours: "24",
  avoidSameArtistWithinTracks: "3",
  preferLikedWeight: "0.35",
  preferUnplayedWeight: "0.7",
  isEnabled: true
};

function stationToForm(station: Station): RuleFormState {
  const rules = station.rules;

  return {
    name: station.name,
    description: station.description ?? "",
    genresInclude: rules.genresInclude.join(", "),
    genresExclude: rules.genresExclude.join(", "),
    artistsInclude: rules.artistsInclude.join(", "),
    artistsExclude: rules.artistsExclude.join(", "),
    albumsInclude: rules.albumsInclude.join(", "),
    albumsExclude: rules.albumsExclude.join(", "),
    yearMin: rules.yearMin?.toString() ?? "",
    yearMax: rules.yearMax?.toString() ?? "",
    recentlyAddedDays: rules.recentlyAddedDays?.toString() ?? "",
    durationMinSec: rules.durationMinSec?.toString() ?? "",
    durationMaxSec: rules.durationMaxSec?.toString() ?? "",
    avoidRepeatHours: rules.avoidRepeatHours.toString(),
    avoidSameArtistWithinTracks: rules.avoidSameArtistWithinTracks.toString(),
    preferLikedWeight: rules.preferLikedWeight.toString(),
    preferUnplayedWeight: rules.preferUnplayedWeight.toString(),
    isEnabled: station.isEnabled
  };
}

function buildRules(form: RuleFormState): StationRules {
  const optionalNumber = (value: string) => {
    if (!value.trim()) {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    genresInclude: splitCsv(form.genresInclude),
    genresExclude: splitCsv(form.genresExclude),
    artistsInclude: splitCsv(form.artistsInclude),
    artistsExclude: splitCsv(form.artistsExclude),
    albumsInclude: splitCsv(form.albumsInclude),
    albumsExclude: splitCsv(form.albumsExclude),
    yearMin: optionalNumber(form.yearMin),
    yearMax: optionalNumber(form.yearMax),
    recentlyAddedDays: optionalNumber(form.recentlyAddedDays),
    durationMinSec: optionalNumber(form.durationMinSec),
    durationMaxSec: optionalNumber(form.durationMaxSec),
    avoidRepeatHours: optionalNumber(form.avoidRepeatHours) ?? 24,
    avoidSameArtistWithinTracks: optionalNumber(form.avoidSameArtistWithinTracks) ?? 3,
    preferLikedWeight: optionalNumber(form.preferLikedWeight) ?? 0.35,
    preferUnplayedWeight: optionalNumber(form.preferUnplayedWeight) ?? 0.7
  };
}

export default function StationsPage() {
  const token = useRequireAuth();
  const [stations, setStations] = useState<Station[]>([]);
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(defaultFormState);
  const [currentStationId, setCurrentStationId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [nextUp, setNextUp] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio();
    const audio = audioRef.current;

    const onEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    const run = async () => {
      try {
        const data = await getStations(token);
        setStations(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stations");
      }
    };

    run().catch(() => {
      // no-op
    });
  }, [token]);

  useEffect(() => {
    if (!nowPlaying || !audioRef.current) {
      return;
    }

    audioRef.current.src = nowPlaying.streamUrl;
    audioRef.current.play().catch(() => {
      setIsPlaying(false);
    });
    setIsPlaying(true);
  }, [nowPlaying]);

  if (!token) {
    return <section className="card">Checking auth...</section>;
  }

  async function refreshStations() {
    const data = await getStations(token);
    setStations(data);
  }

  async function handleStationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setStatus(null);

    try {
      const payload = {
        name: form.name,
        description: form.description,
        rules: buildRules(form),
        isEnabled: form.isEnabled
      };

      if (editingStationId) {
        await updateStationApi(editingStationId, payload, token);
        setStatus("Station updated.");
      } else {
        await createStationApi(payload, token);
        setStatus("Station created.");
      }

      await refreshStations();

      if (!editingStationId) {
        setForm(defaultFormState);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError("Failed to save station");
      }
    } finally {
      setPending(false);
    }
  }

  async function playStation(stationId: string) {
    setError(null);
    setStatus(`Loading station ${stationId}...`);

    try {
      const response = await startStation(stationId, token);
      setCurrentStationId(stationId);
      setNowPlaying(response.nowPlaying);
      setNextUp(response.nextUp);
      setStatus(`Now playing from ${response.station.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start station");
    }
  }

  async function nextTrack() {
    if (!currentStationId) {
      return;
    }

    try {
      const listenedSeconds = Math.floor(audioRef.current?.currentTime ?? 0);
      const previousTrackId = nowPlaying?.navidromeSongId;
      const [nextResponse, peekResponse] = await Promise.all([
        nextStationTrack(currentStationId, token, {
          previousTrackId,
          listenSeconds: listenedSeconds,
          skipped: true
        }),
        peekStation(currentStationId, 10, token)
      ]);
      setNowPlaying(nextResponse.track);
      setNextUp(peekResponse.tracks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load next track");
    }
  }

  function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  async function handleFeedback(liked: boolean) {
    if (!nowPlaying) {
      return;
    }

    try {
      await saveFeedback(
        {
          navidromeSongId: nowPlaying.navidromeSongId,
          liked,
          disliked: !liked
        },
        token
      );
      setStatus(liked ? "Marked as liked" : "Marked as disliked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feedback failed");
    }
  }

  async function removeEditingStation() {
    if (!editingStationId) {
      return;
    }

    try {
      await deleteStationApi(editingStationId, token);
      setForm(defaultFormState);
      setEditingStationId(null);
      await refreshStations();
      setStatus("Station deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete station");
    }
  }

  return (
    <div className="grid">
      <section className="card" style={{ gridColumn: "span 4" }}>
        <h2>Stations</h2>
        <p className="meta">Quick surf between channels.</p>
        <div className="station-list">
          {stations.map((station) => {
            const active = station.id === currentStationId;
            return (
              <div key={station.id} className={`station-item ${active ? "active" : ""}`}>
                <button
                  type="button"
                  onClick={() => {
                    setEditingStationId(station.id);
                    setForm(stationToForm(station));
                  }}
                >
                  {station.name}
                </button>
                <button type="button" className="primary" onClick={() => playStation(station.id)}>
                  Surf
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ gridColumn: "span 4" }}>
        <h2>{editingStationId ? "Edit Station" : "Create Station"}</h2>
        <form onSubmit={handleStationSubmit} style={{ display: "grid", gap: "0.7rem" }}>
          <label>
            Name
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>

          <label>
            Description
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </label>

          <label>
            Genres include (comma-separated)
            <input
              value={form.genresInclude}
              onChange={(event) => setForm((prev) => ({ ...prev, genresInclude: event.target.value }))}
            />
          </label>

          <label>
            Genres exclude
            <input
              value={form.genresExclude}
              onChange={(event) => setForm((prev) => ({ ...prev, genresExclude: event.target.value }))}
            />
          </label>

          <label>
            Artists include
            <input
              value={form.artistsInclude}
              onChange={(event) => setForm((prev) => ({ ...prev, artistsInclude: event.target.value }))}
            />
          </label>

          <label>
            Artists exclude
            <input
              value={form.artistsExclude}
              onChange={(event) => setForm((prev) => ({ ...prev, artistsExclude: event.target.value }))}
            />
          </label>

          <label>
            Albums include
            <input
              value={form.albumsInclude}
              onChange={(event) => setForm((prev) => ({ ...prev, albumsInclude: event.target.value }))}
            />
          </label>

          <label>
            Albums exclude
            <input
              value={form.albumsExclude}
              onChange={(event) => setForm((prev) => ({ ...prev, albumsExclude: event.target.value }))}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <label>
              Year min
              <input
                type="number"
                value={form.yearMin}
                onChange={(event) => setForm((prev) => ({ ...prev, yearMin: event.target.value }))}
              />
            </label>
            <label>
              Year max
              <input
                type="number"
                value={form.yearMax}
                onChange={(event) => setForm((prev) => ({ ...prev, yearMax: event.target.value }))}
              />
            </label>
          </div>

          <label>
            Recently added days
            <input
              type="number"
              value={form.recentlyAddedDays}
              onChange={(event) => setForm((prev) => ({ ...prev, recentlyAddedDays: event.target.value }))}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <label>
              Duration min sec
              <input
                type="number"
                value={form.durationMinSec}
                onChange={(event) => setForm((prev) => ({ ...prev, durationMinSec: event.target.value }))}
              />
            </label>
            <label>
              Duration max sec
              <input
                type="number"
                value={form.durationMaxSec}
                onChange={(event) => setForm((prev) => ({ ...prev, durationMaxSec: event.target.value }))}
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <label>
              Avoid repeat (hours)
              <input
                type="number"
                value={form.avoidRepeatHours}
                onChange={(event) => setForm((prev) => ({ ...prev, avoidRepeatHours: event.target.value }))}
              />
            </label>
            <label>
              Artist separation tracks
              <input
                type="number"
                value={form.avoidSameArtistWithinTracks}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, avoidSameArtistWithinTracks: event.target.value }))
                }
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <label>
              Prefer liked weight
              <input
                type="number"
                step="0.05"
                value={form.preferLikedWeight}
                onChange={(event) => setForm((prev) => ({ ...prev, preferLikedWeight: event.target.value }))}
              />
            </label>
            <label>
              Prefer unplayed weight
              <input
                type="number"
                step="0.05"
                value={form.preferUnplayedWeight}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, preferUnplayedWeight: event.target.value }))
                }
              />
            </label>
          </div>

          <label>
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(event) => setForm((prev) => ({ ...prev, isEnabled: event.target.checked }))}
              style={{ width: "auto", marginRight: "0.5rem" }}
            />
            Enabled
          </label>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="primary" disabled={pending}>
              {pending ? "Saving..." : editingStationId ? "Update Station" : "Create Station"}
            </button>
            {editingStationId ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditingStationId(null);
                    setForm(defaultFormState);
                  }}
                >
                  Cancel edit
                </button>
                <button type="button" className="danger" onClick={removeEditingStation}>
                  Delete
                </button>
              </>
            ) : null}
          </div>
        </form>

        {status ? <p>{status}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card" style={{ gridColumn: "span 4" }}>
        <h2>Now Playing</h2>
        {nowPlaying ? (
          <>
            <h3>{nowPlaying.title}</h3>
            <p className="meta">
              {nowPlaying.artist} {nowPlaying.album ? `• ${nowPlaying.album}` : ""}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.7rem" }}>
              <button onClick={togglePlayPause}>{isPlaying ? "Pause" : "Play"}</button>
              <button className="primary" onClick={nextTrack}>
                Next / Skip
              </button>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={() => handleFeedback(true)}>Like</button>
              <button onClick={() => handleFeedback(false)}>Dislike</button>
            </div>
          </>
        ) : (
          <p className="meta">Select a station and press Surf to start continuous playback.</p>
        )}

        <h3 style={{ marginTop: "1.2rem" }}>Next Up</h3>
        <ol className="queue">
          {nextUp.map((track, index) => (
            <li key={`${track.navidromeSongId}-${index}`}>
              {track.title} <span className="meta">({track.artist})</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
