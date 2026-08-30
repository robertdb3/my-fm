import type {
  AudioMode,
  CreateStationInput,
  FeedbackInput,
  NavidromeConnectionInput,
  NextPlayback,
  Station,
  StationPlayback,
  StationSystemType,
  StationRules,
  Track,
  UserSettings,
  TunerStepResponse
} from "@music-cable-box/shared";
import type { TunerStation } from "@music-cable-box/shared";

const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const DEV_API_URL = "http://localhost:4000";

/**
 * In deployment the API is served from the same origin as the web app (nginx
 * proxies /api to it), so fall back to the page origin instead of a hardcoded
 * host. NEXT_PUBLIC_API_URL still wins when the two are served separately, as
 * they are in local dev.
 */
function apiBaseUrl() {
  if (CONFIGURED_API_URL) {
    return CONFIGURED_API_URL;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return DEV_API_URL;
}

export function buildProxyStreamUrl(params: {
  navidromeSongId: string;
  mode: AudioMode;
  offsetSec?: number;
  format?: "mp3" | "aac";
  bitrateKbps?: number;
}) {
  const url = new URL(`${apiBaseUrl()}/api/stream/${encodeURIComponent(params.navidromeSongId)}`);
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

class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
): Promise<T> {
  const hasBody = options.body !== undefined;
  const headers: Record<string, string> = {};

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = (json as { error?: { message?: string } }).error?.message ?? "Request failed";
    throw new ApiRequestError(message, response.status, json);
  }

  return json as T;
}

export async function getStations(options?: {
  includeHidden?: boolean;
  includeSystem?: boolean;
}) {
  const params = new URLSearchParams();
  if (options?.includeHidden !== undefined) {
    params.set("includeHidden", String(options.includeHidden));
  }
  if (options?.includeSystem !== undefined) {
    params.set("includeSystem", String(options.includeSystem));
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const data = await apiRequest<{ stations: Station[] }>(`/api/stations${suffix}`);
  return data.stations;
}

export async function getTunerStations() {
  const data = await apiRequest<{ stations: TunerStation[] }>("/api/stations/tuner");
  return data.stations;
}

export async function getRuleOptions(field: "genre" | "artist" | "album", query: string) {
  const params = new URLSearchParams({
    field,
    q: query,
    limit: "20"
  });

  return apiRequest<{ options: string[] }>(`/api/stations/rule-options?${params.toString()}`);
}

export async function previewStationRules(payload: { stationId?: string; rules?: StationRules }) {
  return apiRequest<{ matchingTrackCount: number }>("/api/stations/preview", {
    method: "POST",
    body: payload
  });
}

export async function createStationApi(input: CreateStationInput) {
  const data = await apiRequest<{ station: Station }>("/api/stations", {
    method: "POST",
    body: input
  });
  return data.station;
}

export async function updateStationApi(stationId: string, input: Partial<CreateStationInput>) {
  const data = await apiRequest<{ station: Station }>(`/api/stations/${stationId}`, {
    method: "PUT",
    body: input
  });
  return data.station;
}

export async function patchStationApi(
  stationId: string,
  input: {
    isEnabled?: boolean;
    isHidden?: boolean;
  }
) {
  const data = await apiRequest<{ station: Station }>(`/api/stations/${stationId}`, {
    method: "PATCH",
    body: input
  });
  return data.station;
}

export async function deleteStationApi(stationId: string) {
  return apiRequest<{ ok: boolean }>(`/api/stations/${stationId}`, {
    method: "DELETE"
  });
}

export async function startStation(
  stationId: string,
  payload?: {
    seed?: string;
    reason?: "manual" | "resume";
  }
) {
  return apiRequest<{ nowPlaying: Track; nextUp: Track[]; station: Station; playback: StationPlayback }>(
    `/api/stations/${stationId}/play`,
    {
      method: "POST",
      body: payload ?? {}
    }
  );
}

export async function stepTuner(payload?: {
  direction: "NEXT" | "PREV";
  fromStationId?: string;
  wrap?: boolean;
  play?: boolean;
}) {
  return apiRequest<TunerStepResponse>("/api/tuner/step", {
    method: "POST",
    body: payload ?? { direction: "NEXT", wrap: true, play: true }
  });
}

export async function nextStationTrack(
  stationId: string,
  payload?: {
    previousTrackId?: string;
    listenSeconds?: number;
    skipped?: boolean;
    previousStartOffsetSec?: number;
    previousReason?: string;
  }
) {
  return apiRequest<{ track: Track; playback?: NextPlayback }>(`/api/stations/${stationId}/next`, {
    method: "POST",
    body: payload ?? {}
  });
}

export async function peekStation(stationId: string, n = 10) {
  return apiRequest<{ tracks: Track[] }>(`/api/stations/${stationId}/peek?n=${n}`);
}

export async function regenerateSystemStations(payload: {
  types?: StationSystemType[];
  minTracks?: {
    artist?: number;
    genre?: number;
    decade?: number;
  };
  dryRun?: boolean;
}) {
  return apiRequest<{
    created: number;
    updated: number;
    skipped: number;
    disabledOrHidden: number;
    sample: Array<{ type: StationSystemType; key: string; action: string }>;
  }>("/api/stations/system/regenerate", {
    method: "POST",
    body: payload
  });
}

export async function getSettings() {
  const data = await apiRequest<{ settings: UserSettings }>("/api/settings");
  return data.settings;
}

export async function patchSettings(input: { audioMode?: AudioMode }) {
  const data = await apiRequest<{ settings: UserSettings }>("/api/settings", {
    method: "PATCH",
    body: input
  });
  return data.settings;
}

export async function saveFeedback(payload: FeedbackInput) {
  return apiRequest<{ feedback: unknown }>("/api/feedback", {
    method: "POST",
    body: payload
  });
}

export async function testNavidromeConnection(payload: NavidromeConnectionInput) {
  return apiRequest<{
    ok: boolean;
    account: {
      id: string;
      baseUrl: string;
      username: string;
      updatedAt: string;
    };
    security: {
      message: string;
    };
  }>("/api/navidrome/test-connection", {
    method: "POST",
    body: payload
  });
}

export async function importLibrary(payload: { fullResync?: boolean; maxArtists?: number }) {
  return apiRequest<{
    ok: boolean;
    result: {
      importedArtists: number;
      importedAlbums: number;
      importedTracks: number;
    };
  }>("/api/library/import", {
    method: "POST",
    body: payload
  });
}

export { ApiRequestError };
