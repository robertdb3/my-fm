# Music Cable Box (Navidrome Stations MVP)

A full-stack MVP that adds a “channel surfing” experience on top of Navidrome.

- Navidrome remains the source of truth for music scanning and streaming.
- This app manages station definitions, station state, queue generation, play history, and feedback.
- Clients: web (Next.js) + mobile (Expo React Native).

## Stack

- Monorepo: `pnpm` workspaces + Turborepo
- Backend: Node.js + TypeScript + Fastify + Prisma + SQLite
- Shared contracts: `zod` schemas in `packages/shared`
- Web: Next.js App Router
- Mobile: Expo + React Native + `expo-av`

## Repository Structure

```txt
apps/
  api/      Fastify API + Prisma schema + station generator + tests
  web/      Next.js web client
  mobile/   Expo mobile client
packages/
  shared/   zod schemas + shared TS types
```

## MVP Features

- Configure Navidrome connection in app settings
- Import Navidrome library metadata into local `TrackCache`
- Create/edit/delete stations with rule-based filters:
  - genre include/exclude
  - artist include/exclude
  - album include/exclude
  - year range
  - recently added window
  - duration range
  - avoid repeat hours
  - artist separation tracks
- Structured station Rule Builder UI with live match preview
- Auto-generated system stations:
  - Artist channels
  - Genre channels
  - Decade channels
- System station controls:
  - regenerate from library metadata
  - hide/unhide system stations
  - enable/disable any station
- Radio tuner UX on web (`/radio`) and mobile:
  - frequency-style channel labels
  - dial/slider tuning
  - seek step buttons
  - scan mode (auto-seek stations every ~2s, not tracks)
- Tune-in mid-song offsets on station switch (`/play`):
  - starts near the middle of tracks with configurable per-station rules
  - returns `playback.startOffsetSec` metadata for clients
- Audio mode toggle on Radio screen (web + mobile):
  - `Clean` (unmodified)
  - `FM` (mild radio coloration)
  - `AM` (narrow-band vintage radio)
- Stateful playback per station:
  - persistent recent tracks/artists window
  - avoid repeat track window (default 24h)
  - avoid same artist in recent N tracks (default 3)
  - weighted preference for less-recently-played tracks and liked tracks
- Channel surfing: switch stations quickly without losing each station state
- Track feedback: like/dislike
- Play history endpoint
- Guide view: peek next tracks without advancing station state

## Security Model (MVP)

- App auth uses JWT sessions (`/api/auth/login`)
- Navidrome secrets:
  - Preferred path implemented: store Subsonic token material (`token` + `salt`) derived from password
  - Raw Navidrome password is not persisted in app DB
- Tradeoff:
  - Stored token+salt can still authorize Subsonic requests for that account; protect DB and API access

## Prerequisites

- Node.js 20+
- `pnpm` (via corepack)
- Reachable Navidrome instance
- FFmpeg installed and available in PATH (or set `FFMPEG_PATH`)

## Environment Setup

1. Copy env files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/mobile/.env.example apps/mobile/.env
```

2. Edit `apps/api/.env`:

- `DATABASE_URL` (SQLite path)
- `JWT_SECRET`
- `APP_LOGIN_EMAIL` / `APP_LOGIN_PASSWORD`
- optional Subsonic client metadata
- optional `FFMPEG_PATH` if ffmpeg binary is not available as `ffmpeg`

3. Edit `apps/web/.env` and `apps/mobile/.env` API URL values if needed.

## Install + Run (Local)

```bash
pnpm install
pnpm --filter @music-cable-box/api prisma:generate
pnpm --filter @music-cable-box/api prisma:push
pnpm dev
```

Default local URLs:

- API: `http://localhost:4000`
- Web: `http://localhost:3000`
- Mobile: run via Expo (`pnpm dev:mobile`)

## Docker Compose (API + Web)

```bash
docker compose up --build
```

Notes:

- Compose assumes `apps/api/.env` and `apps/web/.env` exist.
- Navidrome runs externally and should be reachable from the containers.

## End-to-End Usage

1. Sign in using app credentials (`APP_LOGIN_EMAIL` / `APP_LOGIN_PASSWORD`).
2. Open Settings and test/save Navidrome connection.
3. Run library import.
4. Create stations in Stations view.
5. (Optional) Click `Generate Stations` to auto-create Artist/Genre/Decade system channels.
6. Tap `Surf` to start playback.
7. Use `Next / Skip` to advance and keep station state moving.
8. Use Like/Dislike to influence weighting.
9. Open `Radio` for tuner-style station switching and scan mode.
   - Scan steps station-to-station every ~2 seconds until stopped.
10. Open Guide page to preview upcoming tracks without advancing state.

## API Surface (MVP)

- `POST /api/auth/login`
- `GET /api/health`
- `POST /api/navidrome/test-connection`
- `GET /api/settings`
- `PATCH /api/settings`
- `POST /api/library/import`
- `GET /api/stations?includeHidden=true|false`
- `POST /api/stations`
- `GET /api/stations/tuner`
- `POST /api/stations/system/regenerate`
- `GET /api/stations/rule-options?field=genre|artist|album&q=&limit=`
- `GET /api/stations/preview?stationId=...`
- `POST /api/stations/preview`
- `GET /api/stations/:id`
- `PUT /api/stations/:id`
- `PATCH /api/stations/:id` (toggle `isEnabled`; toggle `isHidden` for system stations)
- `DELETE /api/stations/:id`
- `POST /api/stations/:id/play`
- `POST /api/stations/:id/next`
- `POST /api/tuner/step`
- `GET /api/stream/:navidromeSongId?mode=&offsetSec=&format=&bitrateKbps=`
- `GET /api/stations/:id/peek?n=10`
- `POST /api/feedback`
- `GET /api/history?stationId=&limit=`

## Tests

- Unit: station scoring logic
- Unit: exclusion behavior for recent track/artist rules
- Unit: decade bucketing + thresholds for auto-generation
- Integration: stations happy path (`create -> list -> play`)
- Integration: 50 sequential `next` calls with no duplicates in the 24h repeat window
- Integration: system station regeneration endpoint

Run:

```bash
pnpm --filter @music-cable-box/api test
```

## How Station Queueing Works

For each next-track request:

1. Load station rules and persisted station state.
2. Build a dynamic SQL filter (`genre/artist/album includes/excludes`, `year`, `duration`, `recently added`) and fetch a bounded candidate pool (`~900` rows max).
3. Exclude:
   - tracks played in the station/user repeat window (default 24h)
   - tracks in station recent-track state
   - artists in the recent artist separation window (default 3)
4. If strict exclusions empty the pool, relax in order:
   - relax artist exclusion first
   - then relax track exclusion only if required to avoid dead-end playback
5. Score candidates with:
   - `baseRandom` in `[0,1]`
   - `recencyBoost = 1 - exp(-hoursSinceLastPlay / halfLifeHours)`
   - `likeBoost = +0.5`
   - `dislikePenalty = -1.0`
   - `artistRepetitionPenalty` for recent artists
6. Sort by score, take top-K (`200`), then weighted-random sample.
7. Persist station state and play event (`advance` path).
8. Return track metadata + proxied stream URL (`/api/stream/:songId`) with mode/offset context.

`peek` runs the same logic in memory and does not persist station state.

Tune-in offset behavior (`POST /api/stations/:id/play`):

- Playback response includes:
  - `playback.startOffsetSec`
  - `playback.reason` (`tune_in`, `manual`, or `resume`)
- Offset is bounded by track duration and station tune-in rule settings.
- `POST /api/stations/:id/next` does not tune in mid-song by default (offset `0`).
- Tune-in is controlled per station with rule fields:
  - `tuneInEnabled` (default `true`)
  - `tuneInMaxFraction` (default `0.6`)
  - `tuneInMinHeadSec` (default `8`)
  - `tuneInMinTailSec` (default `20`)
  - `tuneInProbability` (default `0.9`)

Audio mode behavior (server-side transcoding):

- Playback URLs from station endpoints point to `/api/stream/:songId`.
- The backend transcodes on the fly with FFmpeg so web and mobile hear the same mode.
- Modes:
  - `UNMODIFIED`: clean transcode
  - `FM`: gentle band-limit + compression + subtle noise
  - `AM`: mono narrow band + stronger compression + higher noise floor
- Mode is stored per user in `UserSettings.audioMode`.
- Radio screens load this setting at startup and let you switch `Clean / FM / AM`.
- When mode is changed during playback, clients restart the current track from `0:00` with the new mode (no range-seek in MVP).

CPU note:

- FM/AM proxy streams use live FFmpeg processing and are more CPU-intensive than direct Navidrome passthrough.
- Use lower `bitrateKbps` in stream query or keep fewer concurrent listeners if needed.

Performance notes:

- Candidate pool is bounded and never loads full-library rows into memory.
- Track/play-feedback lookups are scoped to candidate IDs only.
- Short-lived per-station candidate cache reduces repeated SQL work under rapid skip/surf traffic.

## Auto-Generated Stations

Use `POST /api/stations/system/regenerate` to create/update system channels from `TrackCache`.

- Artist: generates `Artist Radio: {Artist}` for artists meeting threshold.
- Genre: generates `Genre Radio: {Genre}` for genres meeting threshold.
- Decade: generates `{Decade} Radio` from track years grouped by decade.

Default thresholds:

- artist: `15`
- genre: `30`
- decade: `50`

Example:

```bash
curl -X POST http://localhost:4000/api/stations/system/regenerate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"minTracks":{"artist":20,"genre":40,"decade":60}}'
```

Stale system stations are preserved but auto-hidden (`isHidden=true`) rather than deleted, so history/state is retained.

## Tuner Ordering and Frequencies

`GET /api/stations/tuner` returns stations in stable tuner order with `tunerIndex` and cosmetic `frequencyLabel`.

Ordering:

1. Non-hidden first
2. System stations before user stations
3. System type groups in this order: `GENRE`, `DECADE`, `ARTIST`
4. Within group: `sortKey` ascending

Frequency labels:

- FM-like range `88.1` to `107.9`
- Base step `0.2`
- If stations exceed available FM slots, frequencies are compressed across the full range

Hide/disable behavior:

- `isHidden` is supported for system stations (hide from default listings and tuner)
- `isEnabled` can be toggled for any station

## Known MVP Limitations

- Library import currently crawls artists/albums/songs sequentially; large libraries may take time.
- Mobile background playback is not fully tuned for production behavior.
- Track “rating” is modeled via like/dislike in MVP.

## License

MIT (see `LICENSE`)
