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

export default function StationsPage() {
  const token = useRequireAuth();

  const [stations, setStations] = useState<Station[]>([]);
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [currentStationId, setCurrentStationId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
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

    audioRef.current.src = nowPlaying.streamUrl;
    audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, [nowPlaying]);

  if (!token) {
    return <section className="card">Checking auth...</section>;
  }

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
