"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Station, Track } from "@music-cable-box/shared";
import {
  createStationApi,
  deleteStationApi,
  getStations,
  nextStationTrack,
  patchStationApi,
  peekStation,
  regenerateSystemStations,
  saveFeedback,
  startStation,
  updateStationApi
} from "../../src/lib/api";
import { NowPlayingPanel } from "../../src/components/stations/now-playing-panel";
import {
  StationEditorPanel,
  type StationSavePayload
} from "../../src/components/stations/station-editor-panel";
import { StationListPanel } from "../../src/components/stations/station-list-panel";
import { useRequireAuth } from "../../src/lib/useRequireAuth";

function getStreamOffsetSec(streamUrl: string): number {
  try {
    const url = new URL(streamUrl);
    const raw = url.searchParams.get("offsetSec");
    if (!raw) {
      return 0;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }

    return parsed;
  } catch {
    return 0;
  }
}

export default function StationsPage() {
  const token = useRequireAuth();

  const [stations, setStations] = useState<Station[]>([]);
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [currentStationId, setCurrentStationId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [currentStartOffsetSec, setCurrentStartOffsetSec] = useState(0);
  const [nextUp, setNextUp] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);

  const [pendingSave, setPendingSave] = useState(false);
  const [pendingRegenerate, setPendingRegenerate] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState<string | null>(null);
  const [showSystemStations, setShowSystemStations] = useState(true);
  const [showHiddenStations, setShowHiddenStations] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const editingStation = useMemo(
    () => stations.find((station) => station.id === editingStationId) ?? null,
    [editingStationId, stations]
  );
  const visibleStations = useMemo(
    () => stations.filter((station) => (showSystemStations ? true : !station.isSystem)),
    [showSystemStations, stations]
  );

  useEffect(() => {
    audioRef.current = new Audio();
    const audio = audioRef.current;

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    const run = async () => {
      try {
        const list = await getStations(token, {
          includeHidden: showHiddenStations
        });
        setStations(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stations");
      }
    };

    run().catch(() => {
      // no-op
    });
  }, [showHiddenStations, token]);

  useEffect(() => {
    if (!nowPlaying || !audioRef.current) {
      return;
    }

    const audio = audioRef.current;
    let cancelled = false;

    const clampStartOffset = (track: Track, startOffsetSec: number) => {
      const durationSec = track.durationSec ?? 0;
      if (!Number.isFinite(startOffsetSec) || startOffsetSec <= 0) {
        return 0;
      }

      if (!Number.isFinite(durationSec) || durationSec <= 1) {
        return startOffsetSec;
      }

      return Math.max(0, Math.min(startOffsetSec, Math.max(0, durationSec - 1)));
    };

    const waitForMetadata = async () => {
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
          reject(new Error("Failed to load metadata"));
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
    };

    const run = async () => {
      const clampedStartOffset = clampStartOffset(nowPlaying, currentStartOffsetSec);
      audio.pause();
      audio.src = nowPlaying.streamUrl;
      audio.load();

      try {
        await waitForMetadata();
      } catch {
        if (cancelled) {
          return;
        }
      }

      if (cancelled) {
        return;
      }

      const streamOffsetSec = getStreamOffsetSec(nowPlaying.streamUrl);
      const localSeekOffsetSec = Math.max(0, clampedStartOffset - streamOffsetSec);
      if (localSeekOffsetSec > 0) {
        try {
          audio.currentTime = localSeekOffsetSec;
        } catch {
          // ignore seek failures before the first playable frame
        }
      }

      try {
        await audio.play();
        if (!cancelled) {
          setIsPlaying(true);
        }
      } catch {
        if (!cancelled) {
          setIsPlaying(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [currentStartOffsetSec, nowPlaying]);

  async function refreshStations() {
    const list = await getStations(token, {
      includeHidden: showHiddenStations
    });
    setStations(list);
  }

  async function handleSave(payload: StationSavePayload) {
    setPendingSave(true);
    setError(null);

    try {
      const stationPayload = {
        name: payload.name,
        description: payload.description,
        rules: payload.rules,
        isEnabled: payload.isEnabled
      };

      if (payload.stationId) {
        await updateStationApi(payload.stationId, stationPayload, token);
      } else {
        await createStationApi(stationPayload, token);
      }

      await refreshStations();
    } finally {
      setPendingSave(false);
    }
  }

  async function handleDelete(stationId: string) {
    await deleteStationApi(stationId, token);

    if (currentStationId === stationId) {
      setCurrentStationId(null);
      setNowPlaying(null);
      setCurrentStartOffsetSec(0);
      setNextUp([]);
      setIsPlaying(false);
    }

    await refreshStations();
  }

  async function handleDuplicate(station: Station) {
    await createStationApi(
      {
        name: `${station.name} (Copy)`,
        description: station.description ?? undefined,
        rules: station.rules,
        isEnabled: station.isEnabled
      },
      token
    );

    await refreshStations();
  }

  async function playStation(stationId: string) {
    setError(null);
    setStatus("Loading station...");

    const station = stations.find((entry) => entry.id === stationId);
    if (station && !station.isEnabled) {
      setStatus(null);
      setError("Station is disabled. Enable it first.");
      return;
    }

    try {
      const response = await startStation(stationId, token);
      setCurrentStationId(stationId);
      setCurrentStartOffsetSec(response.playback.startOffsetSec);
      setNowPlaying(response.nowPlaying);
      setNextUp(response.nextUp);
      setStatus(`Now playing from ${response.station.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start station");
    }
  }

  async function nextTrack(options?: { skipped?: boolean }) {
    if (!currentStationId) {
      return;
    }

    const skipped = options?.skipped ?? true;

    try {
      const listenedSeconds = Math.floor(audioRef.current?.currentTime ?? 0);
      const previousTrackId = nowPlaying?.navidromeSongId;

      const [nextResponse, peekResponse] = await Promise.all([
        nextStationTrack(currentStationId, token, {
          previousTrackId,
          listenSeconds: listenedSeconds,
          skipped
        }),
        peekStation(currentStationId, 10, token)
      ]);

      setCurrentStartOffsetSec(nextResponse.playback?.startOffsetSec ?? 0);
      setNowPlaying(nextResponse.track);
      setNextUp(peekResponse.tracks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load next track");
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const onEnded = () => {
      setIsPlaying(false);
      void nextTrack({
        skipped: false
      });
    };

    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("ended", onEnded);
    };
  }, [currentStationId, currentStartOffsetSec, nowPlaying?.navidromeSongId, token]);

  function togglePlayPause() {
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

  async function likeCurrentTrack(liked: boolean) {
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

  async function handleRegenerateSystemStations() {
    setPendingRegenerate(true);
    setSystemStatus(null);
    setError(null);

    try {
      const result = await regenerateSystemStations({}, token);
      setSystemStatus(
        `System stations: ${result.created} created, ${result.updated} updated, ${result.disabledOrHidden} hidden.`
      );
      await refreshStations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate system stations");
    } finally {
      setPendingRegenerate(false);
    }
  }

  async function handleToggleStationEnabled(stationId: string, isEnabled: boolean) {
    try {
      await patchStationApi(
        stationId,
        {
          isEnabled
        },
        token
      );
      await refreshStations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update station");
    }
  }

  async function handleToggleSystemStationHidden(stationId: string, isHidden: boolean) {
    try {
      await patchStationApi(
        stationId,
        {
          isHidden
        },
        token
      );
      await refreshStations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update station visibility");
    }
  }

  if (!token) {
    return <section className="card">Checking auth...</section>;
  }

  return (
    <>
      <div className="grid">
        <StationListPanel
          stations={visibleStations}
          activeStationId={currentStationId}
          editingStationId={editingStationId}
          showSystemStations={showSystemStations}
          showHiddenStations={showHiddenStations}
          regeneratePending={pendingRegenerate}
          status={systemStatus}
          onEdit={(stationId) => setEditingStationId(stationId)}
          onSurf={playStation}
          onToggleShowSystemStations={() => setShowSystemStations((value) => !value)}
          onToggleShowHiddenStations={() => setShowHiddenStations((value) => !value)}
          onRegenerateSystemStations={handleRegenerateSystemStations}
          onToggleStationEnabled={handleToggleStationEnabled}
          onToggleSystemStationHidden={handleToggleSystemStationHidden}
        />

        <StationEditorPanel
          token={token}
          editingStation={editingStation}
          pending={pendingSave}
          onSave={handleSave}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onCancelEdit={() => setEditingStationId(null)}
        />

        <NowPlayingPanel
          nowPlaying={nowPlaying}
          nextUp={nextUp}
          isPlaying={isPlaying}
          onTogglePlayPause={togglePlayPause}
          onNext={nextTrack}
          onLike={() => likeCurrentTrack(true)}
          onDislike={() => likeCurrentTrack(false)}
        />
      </div>

      {status ? <p>{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
