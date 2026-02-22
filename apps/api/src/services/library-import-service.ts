import type { NavidromeImportInput } from "@music-cable-box/shared";
import { prisma } from "../db";
import { NavidromeClient } from "./navidrome-client";

function parseOptionalDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function getClientForUser(userId: string): Promise<NavidromeClient> {
  const account = await prisma.navidromeAccount.findUnique({ where: { userId } });

  if (!account) {
    throw new Error("Navidrome account is not configured for this user");
  }

  return new NavidromeClient({
    baseUrl: account.baseUrl,
    username: account.username,
    token: account.token,
    salt: account.salt
  });
}

export async function importLibraryForUser(userId: string, input: NavidromeImportInput) {
  const client = await getClientForUser(userId);

  if (input.fullResync) {
    await prisma.trackCache.deleteMany();
  }

  const artists = await client.getArtists();
  const artistsToImport = artists.slice(0, input.maxArtists);

  let albumCount = 0;
  let trackCount = 0;

  for (const artist of artistsToImport) {
    const artistData = await client.getArtist(artist.id);

    for (const album of artistData.albums) {
      albumCount += 1;
      const fullAlbum = await client.getAlbum(album.id);
      const songs = fullAlbum.song ?? [];

      for (const song of songs) {
        trackCount += 1;
        await prisma.trackCache.upsert({
          where: { navidromeSongId: song.id },
          update: {
            title: song.title,
            artist: song.artist,
            album: song.album ?? null,
            albumArtist: song.albumArtist ?? null,
            genre: song.genre ?? null,
            year: song.year ?? null,
            durationSec: song.duration ?? null,
            path: song.path ?? null,
            coverArtId: song.coverArt ?? null,
            addedAt: parseOptionalDate(song.created),
            updatedAt: new Date()
          },
          create: {
            navidromeSongId: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album ?? null,
            albumArtist: song.albumArtist ?? null,
            genre: song.genre ?? null,
            year: song.year ?? null,
            durationSec: song.duration ?? null,
            path: song.path ?? null,
            coverArtId: song.coverArt ?? null,
            addedAt: parseOptionalDate(song.created)
          }
        });
      }
    }
  }

  return {
    importedArtists: artistsToImport.length,
    importedAlbums: albumCount,
    importedTracks: trackCount
  };
}
