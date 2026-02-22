import type { CreateStationInput, FeedbackInput, NavidromeConnectionInput, Station, Track } from "@music-cable-box/shared";

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

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
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

export async function getStations(token?: string | null) {
  const data = await apiRequest<{ stations: Station[] }>("/api/stations", { token });
  return data.stations;
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

export async function deleteStationApi(stationId: string, token?: string | null) {
  return apiRequest<{ ok: boolean }>(`/api/stations/${stationId}`, {
    method: "DELETE",
    token
  });
}

export async function startStation(stationId: string, token?: string | null) {
  return apiRequest<{ nowPlaying: Track; nextUp: Track[]; station: Station }>(`/api/stations/${stationId}/play`, {
    method: "POST",
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
  }
) {
  return apiRequest<{ track: Track }>(`/api/stations/${stationId}/next`, {
    method: "POST",
    body: payload,
    token
  });
}

export async function peekStation(stationId: string, n = 10, token?: string | null) {
  return apiRequest<{ tracks: Track[] }>(`/api/stations/${stationId}/peek?n=${n}`, { token });
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
