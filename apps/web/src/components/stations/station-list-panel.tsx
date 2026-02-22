"use client";

import type { Station } from "@music-cable-box/shared";

interface StationListPanelProps {
  stations: Station[];
  activeStationId: string | null;
  editingStationId: string | null;
  showSystemStations: boolean;
  showHiddenStations: boolean;
  regeneratePending: boolean;
  status?: string | null;
  onEdit(stationId: string): void;
  onSurf(stationId: string): void;
  onToggleShowSystemStations(): void;
  onToggleShowHiddenStations(): void;
  onRegenerateSystemStations(): void;
  onToggleStationEnabled(stationId: string, isEnabled: boolean): void;
  onToggleSystemStationHidden(stationId: string, isHidden: boolean): void;
}

export function StationListPanel({
  stations,
  activeStationId,
  editingStationId,
  showSystemStations,
  showHiddenStations,
  regeneratePending,
  status,
  onEdit,
  onSurf,
  onToggleShowSystemStations,
  onToggleShowHiddenStations,
  onRegenerateSystemStations,
  onToggleStationEnabled,
  onToggleSystemStationHidden
}: StationListPanelProps) {
  return (
    <section className="card" style={{ gridColumn: "span 4" }}>
      <h2>Stations</h2>
      <p className="meta">Quick surf between channels.</p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
        <button type="button" className="primary" onClick={onRegenerateSystemStations} disabled={regeneratePending}>
          {regeneratePending ? "Generating..." : "Generate Stations"}
        </button>
        <button type="button" onClick={onToggleShowSystemStations}>
          {showSystemStations ? "Hide System Stations" : "Show System Stations"}
        </button>
        <button type="button" onClick={onToggleShowHiddenStations}>
          {showHiddenStations ? "Hide Hidden Stations" : "Show Hidden Stations"}
        </button>
      </div>
      {status ? <p className="meta">{status}</p> : null}
      <div className="station-list">
        {stations.map((station) => {
          const active = station.id === activeStationId;
          const editing = station.id === editingStationId;
          return (
            <div key={station.id} className={`station-item ${active ? "active" : ""}`}>
              <div style={{ display: "grid", gap: "0.3rem", minWidth: 0 }}>
                <button type="button" onClick={() => onEdit(station.id)}>
                  {station.name}
                  {editing ? " (editing)" : ""}
                </button>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                  {station.isSystem ? (
                    <span className="station-badge">
                      System {station.systemType ? `• ${station.systemType}` : ""}
                    </span>
                  ) : (
                    <span className="station-badge custom">Custom</span>
                  )}
                  {!station.isEnabled ? <span className="station-badge danger">Disabled</span> : null}
                  {station.isHidden ? <span className="station-badge muted">Hidden</span> : null}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => onSurf(station.id)}
                  disabled={!station.isEnabled}
                >
                  Surf
                </button>
                <button
                  type="button"
                  onClick={() => onToggleStationEnabled(station.id, !station.isEnabled)}
                >
                  {station.isEnabled ? "Disable" : "Enable"}
                </button>
                {station.isSystem ? (
                  <button
                    type="button"
                    onClick={() => onToggleSystemStationHidden(station.id, !station.isHidden)}
                  >
                    {station.isHidden ? "Unhide" : "Hide"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
