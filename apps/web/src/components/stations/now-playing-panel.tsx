"use client";

import { useState } from "react";
import type { Track } from "@music-cable-box/shared";

interface NowPlayingPanelProps {
  nowPlaying: Track | null;
  nextUp: Track[];
  isPlaying: boolean;
  onTogglePlayPause(): void;
  onNext(): void;
  onLike(): void;
  onDislike(): void;
}

export function NowPlayingPanel({
  nowPlaying,
  nextUp,
  isPlaying,
  onTogglePlayPause,
  onNext,
  onLike,
  onDislike
}: NowPlayingPanelProps) {
  const [showNextUp, setShowNextUp] = useState(true);

  return (
    <section className="card" style={{ gridColumn: "span 4" }}>
      <h2>Now Playing</h2>
      {nowPlaying ? (
        <>
          <h3>{nowPlaying.title}</h3>
          <p className="meta">
            {nowPlaying.artist} {nowPlaying.album ? `• ${nowPlaying.album}` : ""}
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.7rem" }}>
            <button type="button" onClick={onTogglePlayPause}>
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button type="button" className="primary" onClick={onNext}>
              Next / Skip
            </button>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={onLike}>
              Like
            </button>
            <button type="button" onClick={onDislike}>
              Dislike
            </button>
          </div>
        </>
      ) : (
        <p className="meta">Select a station and press Surf to start continuous playback.</p>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "1.2rem" }}>
        <h3 style={{ margin: 0 }}>Next Up</h3>
        <button type="button" onClick={() => setShowNextUp((value) => !value)}>
          {showNextUp ? "Hide" : "Show"}
        </button>
      </div>
      {showNextUp ? (
        <ol className="queue">
          {nextUp.map((track, index) => (
            <li key={`${track.navidromeSongId}-${index}`}>
              {track.title} <span className="meta">({track.artist})</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
