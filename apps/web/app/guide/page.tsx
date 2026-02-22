"use client";

import { useEffect, useState } from "react";
import type { Station, Track } from "@music-cable-box/shared";
import { getStations, peekStation } from "../../src/lib/api";
import { useRequireAuth } from "../../src/lib/useRequireAuth";

interface GuideEntry {
  station: Station;
  tracks: Track[];
}

export default function GuidePage() {
  const token = useRequireAuth();
  const [guide, setGuide] = useState<GuideEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      return;
    }

    const loadGuide = async () => {
      setLoading(true);
      setError(null);

      try {
        const stations = await getStations(token);
        const entries = await Promise.all(
          stations.map(async (station) => {
            try {
              const response = await peekStation(station.id, 10, token);
              return {
                station,
                tracks: response.tracks
              };
            } catch {
              return {
                station,
                tracks: []
              };
            }
          })
        );

        setGuide(entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load guide");
      } finally {
        setLoading(false);
      }
    };

    loadGuide().catch(() => {
      // no-op
    });
  }, [token]);

  if (!token) {
    return <section className="card">Checking auth...</section>;
  }

  if (loading) {
    return <section className="card">Building guide preview...</section>;
  }

  return (
    <section className="card">
      <h1>Guide Preview</h1>
      <p className="meta">Peek mode previews next tracks without advancing persistent station playback state.</p>
      {error ? <p className="error">{error}</p> : null}
      <div style={{ display: "grid", gap: "1rem" }}>
        {guide.map((entry) => (
          <article key={entry.station.id} className="station-item" style={{ display: "block" }}>
            <h3>{entry.station.name}</h3>
            <ol className="queue">
              {entry.tracks.map((track, index) => (
                <li key={`${entry.station.id}-${track.navidromeSongId}-${index}`}>
                  {track.title} <span className="meta">({track.artist})</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
