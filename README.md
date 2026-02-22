# Music Channels (Navidrome Stations)

A music-first “channel surfing” experience built on top of a Navidrome server. Create rule-based stations (virtual radio channels) from your personal library and switch between them like a cable box.

## What this is
- **Navidrome**: scans your files, maintains library metadata, and serves audio streams via the Subsonic API.
- **This project**: stores station definitions, station state, play history, and generates “next track” choices for each station.
- **Clients**: web app + mobile app that browse stations and play continuous audio.

## Repository structure (planned)
- `apps/api` — backend (stations service)
- `apps/web` — Next.js web client
- `apps/mobile` — Expo mobile client
- `packages/shared` — shared types + validation schemas

## Prerequisites
- Node.js (LTS recommended)
- pnpm
- A running Navidrome server you can reach from your dev machine

## Setup (placeholder)
1. Clone the repo.
2. Copy environment example files:
   - `cp apps/api/.env.example apps/api/.env`
   - `cp apps/web/.env.example apps/web/.env`
   - `cp apps/mobile/.env.example apps/mobile/.env`
3. Install deps:
   - `pnpm install`
4. Start dev:
   - `pnpm dev`

## Environment variables (high level)
You’ll configure:
- Navidrome base URL
- Navidrome username
- Navidrome auth (token+salt preferred)

See `.env.example` files in each app once scaffolded.

## License
MIT — see `LICENSE`.
