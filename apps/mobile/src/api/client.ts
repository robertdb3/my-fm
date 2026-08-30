import type {
  AudioMode,
  NextPlayback,
  Station,
  StationPlayback,
  Track,
  TunerStation,
  TunerStepResponse,
  UserSettings
} from "@music-cable-box/shared";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export function buildProxyStreamUrl(params: {
  navidromeSongId: string;
  mode: AudioMode;
  offsetSec?: number;
  format?: "mp3" | "aac";
  bitrateKbps?: number;
}) {
  const url = new URL(`${API_BASE_URL}/api/stream/${encodeURIComponent(params.navidromeSongId)}`);
  url.searchParams.set("mode", params.mode);
  if (params.offsetSec !== undefined && params.offsetSec > 0) {
    url.searchParams.set("offsetSec", String(Math.floor(params.offsetSec)));
  }
  if (params.format) {
    url.searchParams.set("format", params.format);
  }
  if (params.bitrateKbps !== undefined) {
    url.searchParams.set("bitrateKbps", String(Math.floor(params.bitrateKbps)));
  }
  return url.toString();
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
) {
  const hasBody = options.body !== undefined;
  const headers: Record<string, string> = {};

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = (payload as { error?: { message?: string } }).error?.message ?? "Request failed";
    throw new Error(message);
  }

  return payload as T;
}

export async function getStations() {
  const response = await request<{ stations: Station[] }>("/api/stations");
  return response.stations;
}

export async function getTunerStations() {
  const response = await request<{ stations: TunerStation[] }>("/api/stations/tuner");
  return response.stations;
}

export async function playStation(
  stationId: string,
  payload?: {
    seed?: string;
    reason?: "manual" | "resume";
  }
) {
  return request<{ nowPlaying: Track; nextUp: Track[]; playback: StationPlayback }>(
    `/api/stations/${stationId}/play`,
    {
      method: "POST",
      body: payload ?? {}
    }
  );
}

export async function stepTuner(payload: {
  direction: "NEXT" | "PREV";
  fromStationId?: string;
  wrap?: boolean;
  play?: boolean;
}) {
  return request<TunerStepResponse>("/api/tuner/step", {
    method: "POST",
    body: payload
  });
}

export async function nextTrack(
  stationId: string,
  payload?: {
    previousTrackId?: string;
    listenSeconds?: number;
    skipped?: boolean;
    previousStartOffsetSec?: number;
    previousReason?: string;
  }
) {
  return request<{ track: Track; playback?: NextPlayback }>(`/api/stations/${stationId}/next`, {
    method: "POST",
    body: payload ?? {}
  });
}

export async function peekStation(stationId: string, n = 10) {
  return request<{ tracks: Track[] }>(`/api/stations/${stationId}/peek?n=${n}`);
}

export async function submitFeedback(payload: {
  navidromeSongId: string;
  liked: boolean;
  disliked: boolean;
}) {
  return request("/api/feedback", {
    method: "POST",
    body: payload
  });
}

export async function testNavidrome(payload: {
  baseUrl: string;
  username: string;
  password: string;
}) {
  return request("/api/navidrome/test-connection", {
    method: "POST",
    body: payload
  });
}

export async function importLibrary(payload: { fullResync: boolean; maxArtists: number }) {
  return request<{ result: { importedTracks: number; importedAlbums: number; importedArtists: number } }>(
    "/api/library/import",
    {
      method: "POST",
      body: payload
    }
  );
}

export async function getSettings() {
  const response = await request<{ settings: UserSettings }>("/api/settings");
  return response.settings;
}

export async function patchSettings(payload: { audioMode?: AudioMode }) {
  const response = await request<{ settings: UserSettings }>("/api/settings", {
    method: "PATCH",
    body: payload
  });
  return response.settings;
}
