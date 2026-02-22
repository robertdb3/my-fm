"use client";

import type { Station } from "@music-cable-box/shared";

interface StationListPanelProps {
  stations: Station[];
  activeStationId: string | null;
  editingStationId: string | null;
  onEdit(stationId: string): void;
  onSurf(stationId: string): void;
}

export function StationListPanel({
  stations,
  activeStationId,
  editingStationId,
  onEdit,
  onSurf
}: StationListPanelProps) {
  return (
    <section className="card" style={{ gridColumn: "span 4" }}>
      <h2>Stations</h2>
      <p className="meta">Quick surf between channels.</p>
      <div className="station-list">
        {stations.map((station) => {
          const active = station.id === activeStationId;
          const editing = station.id === editingStationId;
          return (
            <div key={station.id} className={`station-item ${active ? "active" : ""}`}>
              <button type="button" onClick={() => onEdit(station.id)}>
                {station.name}
                {editing ? " (editing)" : ""}
              </button>
              <button type="button" className="primary" onClick={() => onSurf(station.id)}>
                Surf
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
