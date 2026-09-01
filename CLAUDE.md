# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Planetary Signals is an open-data observatory: a single-page interface that federates live public APIs (USGS, NASA EONET, NOAA/NWS, GBIF, iNaturalist, OBIS, SWPC, ReliefWeb, Earthdata CMR, OpenAlex, World Bank, RIPE Atlas, Open-Meteo, Nominatim) into one map and field log, without collapsing them into a fake unified score. See `README.md` for the full connected-source table and data-ethics stance, and `docs/architecture.md` for the request-path/failure-mode design.

The app is built on **vinext** (a Vite-based Next.js-App-Router-compatible framework) targeting Cloudflare Workers, and is deployed as an OpenAI "Sites"/ChatGPT app (`.openai/hosting.json` holds the hosting project id; `app/chatgpt-auth.ts` reads ChatGPT's `oai-authenticated-user-*` request headers for optional sign-in — this is not a generic auth system, don't treat it as one).

## Commands

Node.js >= 22.13 is required.

```bash
npm run install:ci   # sandboxed, integrity-verified install (wraps `npm ci`)
npm run dev           # vite dev server (vinext + Cloudflare plugin), via WRANGLER_LOG_PATH env
npm run build         # bounded vinext build (scripts/build-verified.sh), required before tests
npm test              # build, then node's built-in test runner over tests/*.test.mjs
npm run lint          # eslint via scripts/sites-env.sh wrapper
npm run db:generate   # drizzle-kit generate, via scripts/sites-env.sh wrapper
```

- `npm test` runs a real build first — the test suite imports the built worker from `dist/server/index.js`, so there is no way to run tests without building.
- To run a single test file directly (after a build has already happened): `node --test tests/planetary-contract.test.mjs`. Node's test runner doesn't support running a single named `test()` block by name without a build-touching wrapper, so filter with `--test-name-pattern` if needed.
- `build`, `lint`, and `db:generate` all funnel through `scripts/sites-env.sh`, which redirects `HOME`, npm cache, and Wrangler/Miniflare state into `.sites-runtime/` inside the repo (keeps installs sandboxed and reproducible instead of touching the real `$HOME`). Don't bypass this wrapper by calling `eslint`/`drizzle-kit`/`vinext` directly unless you also set those env vars yourself.
- `scripts/install-ci.sh` verifies the `vinext` tarball's integrity against `package-lock.json` before installing and refuses to run a second overlapping `npm ci` in the same project (via `flock` + a `/proc` scan) — if install fails with "Another dependency install is already running", check for a stale lock rather than forcing it.

## Architecture

**Request-time federation, not a data warehouse.** `GET /api/signals` (`app/api/signals/route.ts`) runs ~12 independent `AdapterDefinition`s concurrently, each with its own timeout, and maps successful payloads into one shared envelope (`PlanetarySignal`, defined in `lib/planetary/types.ts`). One slow/broken provider can't block the others. The response reports `mode: "live" | "partial" | "sample"` based on how many adapters actually returned data, and backfills with labeled demo records (`lib/planetary/demo.ts`) only when needed — sample records always carry `sample: true` / `freshness: "sample"` and must never be silently indistinguishable from live ones.

**The envelope stays deliberately thin.** Common fields (id, sourceId, category, observedAt, coordinates, severity, confidence, freshness, sourceUrl) answer "what/where/when/how fresh/how trustworthy/where's the original record" — domain-specific values go in `metadata` rather than being forced into shared fields. Don't invent a universal severity scale across categories (an earthquake magnitude and an AQI reading are not comparable).

**`GET /api/probe?lat=&lon=`** (`app/api/probe/route.ts`) is a separate, independent flow: given a validated Earth coordinate, it fan-outs to Open-Meteo (forecast/air/marine) and Nominatim in parallel, each optional and independently degradable. It validates coordinates and rejects invalid ones with 400 before making any upstream request.

**Source registry vs. adapters are two different things.** `lib/planetary/sources.ts` (`SOURCE_REGISTRY`) is a documentation/catalog layer — every known public data system, including ones not yet wired up (`integration: "connected" | "catalogued" | "key-needed"`). Only `connected` sources should have a matching adapter in `app/api/signals/route.ts` or be referenced in `app/api/probe/route.ts`. `tests/planetary-contract.test.mjs` enforces this correspondence (unique IDs, HTTPS doc URLs, license labels, and that every `connected` source ID literally appears in the adapter route source) — see `docs/adding-an-adapter.md` for the full checklist before adding a provider.

**Frontend** is two large client components: `components/planetary/dashboard.tsx` (data fetching, filtering by category/time window, field log, source atlas UI) and `components/planetary/signal-map.tsx` (MapLibre GL rendering/clustering of signals with valid coordinates — non-spatial records stay in the field log only). `components/ui/**` and `hooks/use-mobile.ts` are vendored verbatim from shadcn — ESLint relaxes strict rules there (see `eslint.config.mjs`); don't hand-edit vendored files to fix lint, treat them as generated.

**No database yet.** `db/schema.ts` is intentionally empty (Drizzle/D1 wiring exists in `drizzle.config.ts` and `worker/index.ts`, and `.openai/hosting.json` currently has `d1: null, r2: null`). `examples/d1/db/schema.ts` shows the opt-in pattern to follow if/when a site actually needs persistence — don't add tables speculatively.

**Path alias:** `@/*` maps to the repo root (`tsconfig.json`), matching Next's App Router conventions even though the runtime is vinext/Vite.

## Working with adapters and the source registry

When adding or changing a live data integration, follow `docs/adding-an-adapter.md`:
1. Register/update the entry in `lib/planetary/sources.ts` first; only mark `integration: "connected"` once code actually calls it.
2. Implement the `AdapterDefinition` in `app/api/signals/route.ts` (or extend the probe route for point-query sources): bounded fetch via the shared timeout helper, empty array on no usable records, validated lat/lon, stable provider-prefixed ID, preserved original record URL, no API keys ever reaching the browser.
3. Don't invent precision the provider doesn't have — a polygon's centroid is a display coordinate, not a measurement; put uncertainty in `metadata` if the provider exposes it.
4. Update `tests/planetary-contract.test.mjs` and add attribution to the README's connected-services table once it's live.
