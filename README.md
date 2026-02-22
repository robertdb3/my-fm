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
  - min rating (mapped to liked tracks in MVP)
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
5. Tap `Surf` to start playback.
6. Use `Next / Skip` to advance and keep station state moving.
7. Use Like/Dislike to influence weighting.
8. Open Guide page to preview upcoming tracks without advancing state.

## API Surface (MVP)

- `POST /api/auth/login`
- `GET /api/health`
- `POST /api/navidrome/test-connection`
- `POST /api/library/import`
- `GET /api/stations`
- `POST /api/stations`
- `GET /api/stations/:id`
- `PUT /api/stations/:id`
- `DELETE /api/stations/:id`
- `POST /api/stations/:id/play`
- `POST /api/stations/:id/next`
- `GET /api/stations/:id/peek?n=10`
- `POST /api/feedback`
- `GET /api/history?stationId=&limit=`

## Tests

- Unit: station scoring logic
- Unit: exclusion behavior for recent track/artist rules
- Integration: stations happy path (`create -> list -> play`)
- Integration: 50 sequential `next` calls with no duplicates in the 24h repeat window

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
8. Return track metadata + Navidrome stream URL.

`peek` runs the same logic in memory and does not persist station state.

Performance notes:

- Candidate pool is bounded and never loads full-library rows into memory.
- Track/play-feedback lookups are scoped to candidate IDs only.
- Short-lived per-station candidate cache reduces repeated SQL work under rapid skip/surf traffic.

## Known MVP Limitations

- Library import currently crawls artists/albums/songs sequentially; large libraries may take time.
- Mobile background playback is not fully tuned for production behavior.
- Track “rating” is modeled via like/dislike in MVP.

## License

MIT (see `LICENSE`)
