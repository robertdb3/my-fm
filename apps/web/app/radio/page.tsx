"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioMode, Track, TunerStation } from "@music-cable-box/shared";
import {
  buildProxyStreamUrl,
  getTunerStations,
  getSettings,
  nextStationTrack,
  patchSettings,
  peekStation,
  saveFeedback,
  startStation,
  stepTuner
} from "../../src/lib/api";
import { clampTunerIndex, RADIO_SCAN_INTERVAL_MS, RADIO_TUNE_DEBOUNCE_MS } from "../../src/lib/radio-tuner";
import { useRequireAuth } from "../../src/lib/useRequireAuth";

interface PlaybackMeta {
  startOffsetSec: number;
  reason: string;
}

function clampStartOffset(track: Track, startOffsetSec: number): number {
  const durationSec = track.durationSec ?? 0;
  if (!Number.isFinite(startOffsetSec) || startOffsetSec <= 0) {
    return 0;
  }

  if (!Number.isFinite(durationSec) || durationSec <= 1) {
    return startOffsetSec;
  }

  return Math.max(0, Math.min(startOffsetSec, Math.max(0, durationSec - 1)));
}

export default function RadioPage() {
  const token = useRequireAuth();
  const [stations, setStations] = useState<TunerStation[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentStationId, setCurrentStationId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [nextUp, setNextUp] = useState<Track[]>([]);
  const [currentPlayback, setCurrentPlayback] = useState<PlaybackMeta | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioMode, setAudioMode] = useState<AudioMode>("UNMODIFIED");
  const [audioModePending, setAudioModePending] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tuneTimeoutRef = useRef<number | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const currentIndexRef = useRef(0);
  const currentStationIdRef = useRef<string | null>(null);
  const switchRequestIdRef = useRef(0);

  const currentStation = useMemo(() => stations[currentIndex] ?? null, [currentIndex, stations]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    currentStationIdRef.current = currentStationId;
  }, [currentStationId]);

  useEffect(() => {
    audioRef.current = new Audio();
    const audio = audioRef.current;
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("ended", onEnded);

    return () => {
      if (tuneTimeoutRef.current !== null) {
        window.clearTimeout(tuneTimeoutRef.current);
      }
      if (scanIntervalRef.current !== null) {
        window.clearInterval(scanIntervalRef.current);
      }
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
        setCurrentIndex((value) => clampTunerIndex(value, items.length));
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
    if (!token) {
      return;
    }

    const run = async () => {
      try {
        const settings = await getSettings(token);
        setAudioMode(settings.audioMode);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load audio settings");
      }
    };

    run().catch(() => {
      // no-op
    });
  }, [token]);

  useEffect(() => {
    if (stations.length === 0) {
      return;
    }

    setCurrentIndex((value) => clampTunerIndex(value, stations.length));
  }, [stations.length]);

  function beginSwitchRequest(): number {
    switchRequestIdRef.current += 1;
    return switchRequestIdRef.current;
  }

  function isLatestSwitchRequest(requestId: number): boolean {
    return requestId === switchRequestIdRef.current;
  }

  async function waitForMetadata(audio: HTMLAudioElement): Promise<void> {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Failed to load audio metadata"));
      };
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("canplay", onLoaded);
        audio.removeEventListener("error", onError);
      };

      audio.addEventListener("loadedmetadata", onLoaded);
      audio.addEventListener("canplay", onLoaded);
      audio.addEventListener("error", onError);
    });
  }

  async function playTrack(
    track: Track,
    startOffsetSec: number,
    requestId: number,
    options?: { shouldAutoPlay?: boolean }
  ) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const shouldAutoPlay = options?.shouldAutoPlay ?? true;

    audio.pause();
    audio.src = track.streamUrl;
    audio.load();

    try {
      await waitForMetadata(audio);
    } catch {
      if (!isLatestSwitchRequest(requestId)) {
        return;
      }
    }

    if (!isLatestSwitchRequest(requestId)) {
      return;
    }

    const clampedOffset = clampStartOffset(track, startOffsetSec);
    if (clampedOffset > 0) {
      try {
        audio.currentTime = clampedOffset;
      } catch {
        // ignore seek failures before the first playable frame
      }
    }

    if (!shouldAutoPlay) {
      setIsPlaying(false);
      return;
    }

    try {
      await audio.play();
      if (isLatestSwitchRequest(requestId)) {
        setIsPlaying(true);
      }
    } catch {
      if (isLatestSwitchRequest(requestId)) {
        setIsPlaying(false);
        setStatus("Autoplay blocked. Press Play to start audio.");
      }
    }
  }

  async function tuneToStationIndex(targetIndex: number) {
    const station = stations[targetIndex];
    if (!station) {
      return false;
    }

    if (!station.isEnabled) {
      setError("Station is disabled and cannot be tuned.");
      return false;
    }

    if (currentStationIdRef.current === station.id) {
      setCurrentIndex(targetIndex);
      return true;
    }

    const requestId = beginSwitchRequest();
    setCurrentIndex(targetIndex);
    setStatus(`Tuning ${station.frequencyLabel}...`);
    setError(null);

    try {
      const response = await startStation(station.id, token, { reason: "manual" });
      if (!isLatestSwitchRequest(requestId)) {
        return false;
      }

      setCurrentStationId(station.id);
      setNowPlaying(response.nowPlaying);
      setNextUp(response.nextUp);
      setCurrentPlayback(response.playback);
      await playTrack(response.nowPlaying, response.playback.startOffsetSec, requestId);

      if (!isLatestSwitchRequest(requestId)) {
        return false;
      }

      setStatus(`Locked on ${station.frequencyLabel} • ${station.name}`);
      return true;
    } catch (err) {
      if (!isLatestSwitchRequest(requestId)) {
        return false;
      }

      setError(err instanceof Error ? err.message : "Failed to tune station");
      return false;
    }
  }

  async function stepStation(direction: "NEXT" | "PREV") {
    if (stations.length === 0) {
      return false;
    }

    const requestId = beginSwitchRequest();
    setError(null);

    try {
      const response = await stepTuner(token, {
        direction,
        fromStationId: currentStationIdRef.current ?? stations[currentIndexRef.current]?.id,
        wrap: true,
        play: true
      });

      if (!isLatestSwitchRequest(requestId)) {
        return false;
      }

      setCurrentIndex(response.station.tunerIndex);
      setCurrentStationId(response.station.id);
      setStatus(`Locked on ${response.station.frequencyLabel} • ${response.station.name}`);

      if (response.nowPlaying) {
        setNowPlaying(response.nowPlaying);
      }
      if (response.nextUp) {
        setNextUp(response.nextUp);
      }
      if (response.playback) {
        setCurrentPlayback(response.playback);
      }

      if (response.nowPlaying && response.playback) {
        await playTrack(response.nowPlaying, response.playback.startOffsetSec, requestId);
      }

      if (!isLatestSwitchRequest(requestId)) {
        return false;
      }

      return true;
    } catch (err) {
      if (!isLatestSwitchRequest(requestId)) {
        return false;
      }

      setError(err instanceof Error ? err.message : "Failed to step tuner");
      return false;
    }
  }

  function scheduleTune(targetIndex: number, immediate: boolean) {
    if (isScanning) {
      setIsScanning(false);
    }

    if (tuneTimeoutRef.current !== null) {
      window.clearTimeout(tuneTimeoutRef.current);
      tuneTimeoutRef.current = null;
    }

    setCurrentIndex(targetIndex);
    if (immediate) {
      void tuneToStationIndex(targetIndex);
      return;
    }

    tuneTimeoutRef.current = window.setTimeout(() => {
      void tuneToStationIndex(targetIndex);
      tuneTimeoutRef.current = null;
    }, RADIO_TUNE_DEBOUNCE_MS);
  }

  useEffect(() => {
    if (!isScanning || stations.length === 0) {
      if (scanIntervalRef.current !== null) {
        window.clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
      return;
    }

    if (scanIntervalRef.current !== null) {
      window.clearInterval(scanIntervalRef.current);
    }

    scanIntervalRef.current = window.setInterval(() => {
      void stepStation("NEXT").then((success) => {
        if (!success) {
          setIsScanning(false);
        }
      });
    }, RADIO_SCAN_INTERVAL_MS);

    return () => {
      if (scanIntervalRef.current !== null) {
        window.clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, [isScanning, stations.length, token]);

  async function onNextTrack() {
    if (!currentStationId) {
      return;
    }

    if (isScanning) {
      setIsScanning(false);
    }

    try {
      const listenSeconds = Math.floor(audioRef.current?.currentTime ?? 0);
      const requestId = beginSwitchRequest();
      const [nextResponse, peekResponse] = await Promise.all([
        nextStationTrack(currentStationId, token, {
          previousTrackId: nowPlaying?.navidromeSongId,
          listenSeconds,
          skipped: true,
          previousStartOffsetSec: currentPlayback?.startOffsetSec ?? 0,
          previousReason: currentPlayback?.reason
        }),
        peekStation(currentStationId, 10, token)
      ]);

      if (!isLatestSwitchRequest(requestId)) {
        return;
      }

      setNowPlaying(nextResponse.track);
      setCurrentPlayback({
        startOffsetSec: nextResponse.playback?.startOffsetSec ?? 0,
        reason: nextResponse.playback?.reason ?? "next"
      });
      setNextUp(peekResponse.tracks);
      await playTrack(nextResponse.track, nextResponse.playback?.startOffsetSec ?? 0, requestId);
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

  async function onChangeAudioMode(nextMode: AudioMode) {
    if (!token || nextMode === audioMode) {
      return;
    }

    const previousMode = audioMode;
    setAudioMode(nextMode);
    setAudioModePending(true);
    setError(null);

    try {
      await patchSettings(
        {
          audioMode: nextMode
        },
        token
      );

      setStatus(
        nextMode === "UNMODIFIED"
          ? "Audio mode set to Clean"
          : nextMode === "FM"
            ? "Audio mode set to FM"
            : "Audio mode set to AM"
      );

      if (nowPlaying) {
        const audio = audioRef.current;
        const resumeOffsetSec = clampStartOffset(
          nowPlaying,
          audio && Number.isFinite(audio.currentTime) && audio.currentTime > 0
            ? audio.currentTime
            : 0
        );
        const shouldResumePlayback = audio ? !audio.paused : isPlaying;
        const requestId = beginSwitchRequest();
        const updatedTrack: Track = {
          ...nowPlaying,
          streamUrl: buildProxyStreamUrl({
            navidromeSongId: nowPlaying.navidromeSongId,
            mode: nextMode
          })
        };
        setNowPlaying(updatedTrack);
        setCurrentPlayback({
          startOffsetSec: resumeOffsetSec,
          reason: "manual"
        });
        await playTrack(updatedTrack, resumeOffsetSec, requestId, {
          shouldAutoPlay: shouldResumePlayback
        });
      }
    } catch (err) {
      setAudioMode(previousMode);
      setError(err instanceof Error ? err.message : "Failed to update audio mode");
    } finally {
      setAudioModePending(false);
    }
  }

  if (!token) {
    return <section className="card">Checking auth...</section>;
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
              {isScanning ? <p className="meta">Scanning...</p> : null}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
              <span className="meta" style={{ alignSelf: "center", marginBottom: 0 }}>
                Audio:
              </span>
              <button
                type="button"
                className={audioMode === "UNMODIFIED" ? "primary" : undefined}
                onClick={() => void onChangeAudioMode("UNMODIFIED")}
                disabled={audioModePending}
              >
                Clean
              </button>
              <button
                type="button"
                className={audioMode === "FM" ? "primary" : undefined}
                onClick={() => void onChangeAudioMode("FM")}
                disabled={audioModePending}
              >
                FM
              </button>
              <button
                type="button"
                className={audioMode === "AM" ? "primary" : undefined}
                onClick={() => void onChangeAudioMode("AM")}
                disabled={audioModePending}
              >
                AM
              </button>
            </div>
            <p className="meta" style={{ marginBottom: "0.6rem" }}>
              FM = mild radio coloration. AM = narrow-band vintage radio.
            </p>

            <input
              className="tuner-slider"
              type="range"
              min={0}
              max={Math.max(0, stations.length - 1)}
              value={currentIndex}
              onChange={(event) => {
                scheduleTune(Number(event.target.value), false);
              }}
              onMouseUp={() => scheduleTune(currentIndexRef.current, true)}
              onTouchEnd={() => scheduleTune(currentIndexRef.current, true)}
              disabled={stations.length === 0}
            />

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.8rem" }}>
              <button
                type="button"
                onClick={() => {
                  setIsScanning(false);
                  void stepStation("PREV");
                }}
                disabled={stations.length === 0}
              >
                ◀ Seek
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsScanning(false);
                  void stepStation("NEXT");
                }}
                disabled={stations.length === 0}
              >
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
