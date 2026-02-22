import type {
  CreateStationInput,
  FeedbackInput,
  NavidromeConnectionInput,
  NextPlayback,
  Station,
  StationPlayback,
  StationSystemType,
  StationRules,
  Track,
  TunerStepResponse
} from "@music-cable-box/shared";
import type { TunerStation } from "@music-cable-box/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "music-cable-box-token";

export function getAuthToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearAuthToken() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
  }
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
    token?: string | null;
  } = {}
): Promise<T> {
  const token = options.token ?? getAuthToken();
  const hasBody = options.body !== undefined;
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
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

export async function login(email: string, password: string) {
  return apiRequest<{ token: string; user: { id: string; email: string | null } }>("/api/auth/login", {
    method: "POST",
    body: {
      email,
      password
    },
    token: null
  });
}

export async function getStations(
  token?: string | null,
  options?: {
    includeHidden?: boolean;
    includeSystem?: boolean;
  }
) {
  const params = new URLSearchParams();
  if (options?.includeHidden !== undefined) {
    params.set("includeHidden", String(options.includeHidden));
  }
  if (options?.includeSystem !== undefined) {
    params.set("includeSystem", String(options.includeSystem));
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const data = await apiRequest<{ stations: Station[] }>(`/api/stations${suffix}`, { token });
  return data.stations;
}

export async function getTunerStations(token?: string | null) {
  const data = await apiRequest<{ stations: TunerStation[] }>("/api/stations/tuner", { token });
  return data.stations;
}

export async function getRuleOptions(
  field: "genre" | "artist" | "album",
  query: string,
  token?: string | null
) {
  const params = new URLSearchParams({
    field,
    q: query,
    limit: "20"
  });

  return apiRequest<{ options: string[] }>(`/api/stations/rule-options?${params.toString()}`, { token });
}

export async function previewStationRules(
  payload: {
    stationId?: string;
    rules?: StationRules;
  },
  token?: string | null
) {
  return apiRequest<{ matchingTrackCount: number }>("/api/stations/preview", {
    method: "POST",
    body: payload,
    token
  });
}

export async function createStationApi(input: CreateStationInput, token?: string | null) {
  const data = await apiRequest<{ station: Station }>("/api/stations", {
    method: "POST",
    body: input,
    token
  });
  return data.station;
}

export async function updateStationApi(stationId: string, input: Partial<CreateStationInput>, token?: string | null) {
  const data = await apiRequest<{ station: Station }>(`/api/stations/${stationId}`, {
    method: "PUT",
    body: input,
    token
  });
  return data.station;
}

export async function patchStationApi(
  stationId: string,
  input: {
    isEnabled?: boolean;
    isHidden?: boolean;
  },
  token?: string | null
) {
  const data = await apiRequest<{ station: Station }>(`/api/stations/${stationId}`, {
    method: "PATCH",
    body: input,
    token
  });
  return data.station;
}

export async function deleteStationApi(stationId: string, token?: string | null) {
  return apiRequest<{ ok: boolean }>(`/api/stations/${stationId}`, {
    method: "DELETE",
    token
  });
}

export async function startStation(
  stationId: string,
  token?: string | null,
  payload?: {
    seed?: string;
    reason?: "manual" | "resume";
  }
) {
  return apiRequest<{ nowPlaying: Track; nextUp: Track[]; station: Station; playback: StationPlayback }>(
    `/api/stations/${stationId}/play`,
    {
      method: "POST",
      body: payload ?? {},
      token
    }
  );
}

export async function stepTuner(
  token?: string | null,
  payload?: {
    direction: "NEXT" | "PREV";
    fromStationId?: string;
    wrap?: boolean;
    play?: boolean;
  }
) {
  return apiRequest<TunerStepResponse>("/api/tuner/step", {
    method: "POST",
    body: payload ?? { direction: "NEXT", wrap: true, play: true },
    token
  });
}

export async function nextStationTrack(
  stationId: string,
  token?: string | null,
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
    body: payload ?? {},
    token
  });
}

export async function peekStation(stationId: string, n = 10, token?: string | null) {
  return apiRequest<{ tracks: Track[] }>(`/api/stations/${stationId}/peek?n=${n}`, { token });
}

export async function regenerateSystemStations(
  payload: {
    types?: StationSystemType[];
    minTracks?: {
      artist?: number;
      genre?: number;
      decade?: number;
    };
    dryRun?: boolean;
  },
  token?: string | null
) {
  return apiRequest<{
    created: number;
    updated: number;
    skipped: number;
    disabledOrHidden: number;
    sample: Array<{ type: StationSystemType; key: string; action: string }>;
  }>("/api/stations/system/regenerate", {
    method: "POST",
    body: payload,
    token
  });
}

export async function saveFeedback(payload: FeedbackInput, token?: string | null) {
  return apiRequest<{ feedback: unknown }>("/api/feedback", {
    method: "POST",
    body: payload,
    token
  });
}

export async function testNavidromeConnection(payload: NavidromeConnectionInput, token?: string | null) {
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
    body: payload,
    token
  });
}

export async function importLibrary(payload: { fullResync?: boolean; maxArtists?: number }, token?: string | null) {
  return apiRequest<{
    ok: boolean;
    result: {
      importedArtists: number;
      importedAlbums: number;
      importedTracks: number;
    };
  }>("/api/library/import", {
    method: "POST",
    body: payload,
    token
  });
}

export { ApiRequestError };
