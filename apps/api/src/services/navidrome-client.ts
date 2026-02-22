import { env } from "../config";
import { normalizeBaseUrl } from "../lib/subsonic";

type SubsonicResponse<T> = {
  "subsonic-response": {
    status: "ok" | "failed";
    version: string;
    error?: {
      code: number;
      message: string;
    };
  } & T;
};

export interface NavidromeCredentials {
  baseUrl: string;
  username: string;
  token: string;
  salt: string;
}

export interface NavidromeSong {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  duration?: number;
  path?: string;
  coverArt?: string;
  created?: string;
}

export interface NavidromeAlbum {
  id: string;
  name: string;
  artist?: string;
  song?: NavidromeSong[];
}

export interface NavidromeArtist {
  id: string;
  name: string;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export class NavidromeClient {
  private readonly credentials: NavidromeCredentials;

  constructor(credentials: NavidromeCredentials) {
    this.credentials = {
      ...credentials,
      baseUrl: normalizeBaseUrl(credentials.baseUrl)
    };
  }

  private buildAuthParams() {
    return {
      u: this.credentials.username,
      t: this.credentials.token,
      s: this.credentials.salt,
      v: env.SUBSONIC_API_VERSION,
      c: env.SUBSONIC_CLIENT_NAME,
      f: "json"
    };
  }

  private async request<T extends Record<string, unknown>>(
    endpoint: string,
    params: Record<string, string | number | boolean> = {}
  ): Promise<SubsonicResponse<T>["subsonic-response"]> {
    const url = new URL(`${this.credentials.baseUrl}/rest/${endpoint}.view`);
    const allParams = {
      ...this.buildAuthParams(),
      ...params
    };

    for (const [key, value] of Object.entries(allParams)) {
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Navidrome request failed (${response.status})`);
    }

    const json = (await response.json()) as SubsonicResponse<T>;

    if (json["subsonic-response"].status !== "ok") {
      const message = json["subsonic-response"].error?.message ?? "Navidrome API error";
      throw new Error(message);
    }

    return json["subsonic-response"];
  }

  async ping(): Promise<boolean> {
    await this.request("ping");
    return true;
  }

  async search3(query: string, artistCount = 20, albumCount = 20, songCount = 50) {
    return this.request<{ searchResult3: unknown }>("search3", {
      query,
      artistCount,
      albumCount,
      songCount
    });
  }

  async getArtists(): Promise<NavidromeArtist[]> {
    const response = await this.request<{
      artists?: {
        index?:
          | {
              artist?: NavidromeArtist[] | NavidromeArtist;
            }
          | Array<{
              artist?: NavidromeArtist[] | NavidromeArtist;
            }>;
      };
    }>("getArtists");

    const indexes = toArray(response.artists?.index);
    const artists: NavidromeArtist[] = [];

    for (const index of indexes) {
      artists.push(...toArray(index.artist));
    }

    return artists;
  }

  async getArtist(artistId: string): Promise<{ id: string; name: string; albums: NavidromeAlbum[] }> {
    const response = await this.request<{
      artist: {
        id: string;
        name: string;
        album?: NavidromeAlbum[] | NavidromeAlbum;
      };
    }>("getArtist", { id: artistId });

    return {
      id: response.artist.id,
      name: response.artist.name,
      albums: toArray(response.artist.album)
    };
  }

  async getAlbum(albumId: string): Promise<NavidromeAlbum> {
    const response = await this.request<{
      album: NavidromeAlbum;
    }>("getAlbum", { id: albumId });

    return {
      ...response.album,
      song: toArray(response.album.song)
    };
  }

  async getSong(songId: string): Promise<NavidromeSong> {
    const response = await this.request<{
      song: NavidromeSong;
    }>("getSong", { id: songId });

    return response.song;
  }

  buildStreamUrl(songId: string): string {
    const url = new URL(`${this.credentials.baseUrl}/rest/stream.view`);
    const params = {
      ...this.buildAuthParams(),
      id: songId
    };

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  buildCoverArtUrl(coverArtId: string): string {
    const url = new URL(`${this.credentials.baseUrl}/rest/getCoverArt.view`);
    const params = {
      ...this.buildAuthParams(),
      id: coverArtId
    };

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }
}
