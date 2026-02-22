"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Track, TunerStation } from "@music-cable-box/shared";
import {
  getTunerStations,
  nextStationTrack,
  peekStation,
  saveFeedback,
  startStation
} from "../../src/lib/api";
import { clampTunerIndex, RADIO_TUNE_DEBOUNCE_MS, stepTunerIndex } from "../../src/lib/radio-tuner";
import { useRequireAuth } from "../../src/lib/useRequireAuth";

export default function RadioPage() {
  const token = useRequireAuth();
  const [stations, setStations] = useState<TunerStation[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentStationId, setCurrentStationId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [nextUp, setNextUp] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tuneTimeoutRef = useRef<number | null>(null);
  const lastTunedStationIdRef = useRef<string | null>(null);

  const currentStation = useMemo(() => stations[currentIndex] ?? null, [currentIndex, stations]);

  useEffect(() => {
    audioRef.current = new Audio();
    const audio = audioRef.current;
    const onEnded = () => setIsPlaying(false);
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
        const items = await getTunerStations(token);
        setStations(items);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tuner stations");
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
    audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, [nowPlaying]);

  useEffect(() => {
    if (stations.length === 0) {
      return;
    }

    setCurrentIndex((value) => clampTunerIndex(value, stations.length));
  }, [currentIndex, stations.length]);

  useEffect(() => {
    if (!isScanning || stations.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      tuneByDelta(1, true);
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isScanning, stations.length]);

  if (!token) {
    return <section className="card">Checking auth...</section>;
  }

  async function tuneToIndex(targetIndex: number) {
    const station = stations[targetIndex];
    if (!station) {
      return;
    }

    if (!station.isEnabled) {
      setError("Station is disabled and cannot be tuned.");
      return;
    }

    if (lastTunedStationIdRef.current === station.id && currentStationId === station.id) {
      return;
    }

    setStatus(`Tuning ${station.frequencyLabel}...`);
    setError(null);

    try {
      const response = await startStation(station.id, token);
      setCurrentStationId(station.id);
      setNowPlaying(response.nowPlaying);
      setNextUp(response.nextUp);
      setStatus(`Locked on ${station.frequencyLabel} • ${station.name}`);
      lastTunedStationIdRef.current = station.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to tune station");
    }
  }

  function scheduleTune(targetIndex: number, immediate: boolean) {
    if (tuneTimeoutRef.current !== null) {
      window.clearTimeout(tuneTimeoutRef.current);
      tuneTimeoutRef.current = null;
    }

    setCurrentIndex(targetIndex);
    if (immediate) {
      void tuneToIndex(targetIndex);
      return;
    }

    tuneTimeoutRef.current = window.setTimeout(() => {
      void tuneToIndex(targetIndex);
      tuneTimeoutRef.current = null;
    }, RADIO_TUNE_DEBOUNCE_MS);
  }

  function tuneByDelta(delta: number, immediate = true) {
    if (stations.length === 0) {
      return;
    }

    const nextIndex = stepTunerIndex(currentIndex, delta, stations.length);
    scheduleTune(nextIndex, immediate);
  }

  async function onNextTrack() {
    if (!currentStationId) {
      return;
    }

    try {
      const listenSeconds = Math.floor(audioRef.current?.currentTime ?? 0);
      const [nextResponse, peekResponse] = await Promise.all([
        nextStationTrack(currentStationId, token, {
          previousTrackId: nowPlaying?.navidromeSongId,
          listenSeconds,
          skipped: true
        }),
        peekStation(currentStationId, 10, token)
      ]);
      setNowPlaying(nextResponse.track);
      setNextUp(peekResponse.tracks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to skip track");
    }
  }

  function onTogglePlayPause() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      return;
    }

    audio.pause();
    setIsPlaying(false);
  }

  async function onFeedback(liked: boolean) {
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
      setStatus(liked ? "Track liked" : "Track disliked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save feedback");
    }
  }

  return (
    <div className="grid">
      <section className="card" style={{ gridColumn: "span 7" }}>
        <h2>Radio Tuner</h2>
        {stations.length === 0 ? <p className="meta">No stations available. Generate channels first.</p> : null}
        {currentStation ? (
          <>
            <div className="tuner-display">
              <p className="tuner-frequency">{currentStation.frequencyLabel}</p>
              <p className="tuner-station">{currentStation.name}</p>
            </div>

            <input
              className="tuner-slider"
              type="range"
              min={0}
              max={Math.max(0, stations.length - 1)}
              value={currentIndex}
              onChange={(event) => {
                scheduleTune(Number(event.target.value), false);
              }}
              onMouseUp={() => scheduleTune(currentIndex, true)}
              onTouchEnd={() => scheduleTune(currentIndex, true)}
              disabled={stations.length === 0}
            />

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.8rem" }}>
              <button type="button" onClick={() => tuneByDelta(-1, true)} disabled={stations.length === 0}>
                ◀ Seek
              </button>
              <button type="button" onClick={() => tuneByDelta(1, true)} disabled={stations.length === 0}>
                Seek ▶
              </button>
              <button
                type="button"
                className={isScanning ? "danger" : "primary"}
                onClick={() => setIsScanning((value) => !value)}
                disabled={stations.length === 0}
              >
                {isScanning ? "Stop Scan" : "Scan"}
              </button>
            </div>
          </>
        ) : null}
      </section>

      <section className="card" style={{ gridColumn: "span 5" }}>
        <h2>Now Playing</h2>
        {nowPlaying ? (
          <>
            <h3>{nowPlaying.title}</h3>
            <p className="meta">
              {nowPlaying.artist}
              {nowPlaying.album ? ` • ${nowPlaying.album}` : ""}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
              <button type="button" onClick={onTogglePlayPause}>
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button type="button" className="primary" onClick={onNextTrack}>
                Next / Skip
              </button>
              <button type="button" onClick={() => onFeedback(true)}>
                Like
              </button>
              <button type="button" onClick={() => onFeedback(false)}>
                Dislike
              </button>
            </div>
          </>
        ) : (
          <p className="meta">Tune a station to begin playback.</p>
        )}

        <h3>Next Up</h3>
        <ol className="queue">
          {nextUp.map((track, index) => (
            <li key={`${track.navidromeSongId}-${index}`}>
              {track.title} <span className="meta">({track.artist})</span>
            </li>
          ))}
        </ol>

        {status ? <p>{status}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>
    </div>
  );
}
