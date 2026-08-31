# Provider integration runbook

Status snapshot: 2026-08-31

This is the handoff document for an implementation agent or project owner. It covers the 18 providers originally identified as key-needed or access-dependent and separates owner-only steps from work an agent can complete.

## Current reconciliation

| Source | Current repository state | What remains |
| --- | --- | --- |
| OpenAQ | Adapter implemented; `unconfigured` without a key | Owner creates a key and adds `OPENAQ_API_KEY` |
| eBird | Adapter implemented; `unconfigured` without a key | Owner creates a key and adds `EBIRD_API_KEY` |
| OpenTopography | Point-probe adapter implemented; `unconfigured` without a key | Owner creates a key and adds `OPENTOPOGRAPHY_API_KEY` |
| NASA DONKI | Connected through the public CCMC DONKI service | Monitor the interface; no key required for this adapter |
| ReliefWeb | Existing live adapter | No integration work; retain attribution and filters |

Real credentials must go in `.env.local` for local work and in the deployment secret manager for production. Never paste them into source, issues, pull requests, screenshots, client-side JavaScript or build logs.

## Standard implementation recipe

Use this sequence for every source:

1. Read the provider's current official API documentation and terms on the day work begins.
2. Record the exact endpoint/version, authentication method, limits, licence, attribution and redistribution constraints in the pull request.
3. Decide its shape: `event`, `probe`, `raster` or `batch`. Do not force rasters or archives into `/api/signals`.
4. Obtain access through the provider's normal registration or approval flow. Do not automate account creation or bypass a portal.
5. Add only the secret name to `.env.example`; add the real value to local/deployment secrets.
6. Capture a small redacted response fixture and schema notes. Do not store tokens, personal details or sensitive coordinates.
7. Implement a bounded server-side request with timeout, caching, rate budget, retry/backoff and a stable user agent.
8. Normalize observed time separately from publication/ingestion time; preserve provider identifiers, units, quality flags and record URLs.
9. Return `unconfigured` for a missing secret, `offline` for transport/auth failure and `degraded` for a valid response with no usable records or partial parsing.
10. Add contract, fixture, invalid-payload and timeout tests. Confirm one failed provider cannot fail the aggregate response.
11. Run locally, deploy to a private/staging environment, inspect at least ten records and compare them with provider pages.
12. Mark the registry source `connected` only after the deployed adapter is observable and the licence/sensitivity review passes.

## Free self-serve access

### OpenAQ (`openaq`)

Owner steps:

1. Create an OpenAQ account/key using the official API-key flow.
2. Put the value in `OPENAQ_API_KEY` locally and in the deployment secret manager.
3. Confirm the intended use complies with OpenAQ and upstream-provider terms.

Agent steps:

1. The implemented adapter calls API v3 server-side with the `X-API-Key` header and retrieves the latest PM2.5 values.
2. Run `/api/signals`; verify the `openaq` status changes from `unconfigured` to `online` and contains coordinates, UTC times and µg/m³ units.
3. Check values against the OpenAQ explorer and preserve sensor/location IDs.
4. Add paging or regional sampling only after defining a fair global sampling strategy; “first page” must not be presented as complete global coverage.
5. Add a provider-rate budget and freshness alert before increasing volume.

Acceptance: no key in browser traffic; at least ten valid points; impossible coordinates rejected; stale timestamps visible; PM2.5 severity logic documented as an interface band, not an official health warning.

### eBird (`ebird`)

Owner steps:

1. Request an eBird API key at the official key-generation page.
2. Put it in `EBIRD_API_KEY` locally and in deployment secrets.
3. Confirm that public display and caching comply with eBird terms.

Agent steps:

1. The implemented adapter calls recent-observation endpoints with `X-eBirdApiToken` for a bounded set of country regions.
2. Optionally set `EBIRD_REGIONS` to a comma-separated list of reviewed country/region codes; keep a strict maximum.
3. Verify checklist links, observation times, reviewed/provisional flags and counts.
4. Apply provider obfuscation as delivered. Never attempt to reverse hidden coordinates.
5. Add tests for missing counts, provisional records and a region with no observations.

Acceptance: status `online`; all records have valid coordinates and provider links; sensitive/obscured locations remain protected; the UI never implies an observation is a population estimate.

### OpenTopography (`open-topography`)

Owner steps:

1. Create a free OpenTopography account and obtain a personal API key.
2. Review daily limits and the one-user/one-key terms. A public multi-user product may require an enterprise arrangement; confirm this before broad launch.
3. Put the value in `OPENTOPOGRAPHY_API_KEY` locally and in deployment secrets.

Agent steps:

1. The implemented point probe calls `/API/v1/elevation` with latitude, longitude and the `COP30` dataset.
2. Probe known locations and verify elevation, dataset and vertical-datum fields against provider output.
3. Cache by rounded coordinate and dataset so repeat clicks do not consume daily quota.
4. Keep area DEM downloads out of the request path. Build them as a separate raster job using bounded boxes and COG output.
5. Display dataset resolution and vertical datum before comparing elevations from different products.

Acceptance: terrain appears only when configured; key is server-side; quota use is bounded; the UI names the dataset and does not confuse a surface model with bare-earth terrain.

### NASA DONKI (`nasa-donki`)

No owner credential is currently required. The connected adapter uses the current public NASA CCMC DONKI web service for a bounded 14-day flare window.

Agent follow-up:

1. Add CME and geomagnetic-storm event types behind fixtures.
2. Deduplicate linked events by DONKI activity ID.
3. Preserve the provider warning that DONKI is research/prototyping information, not an operational safety service.
4. Add a schema-drift alert because the service is not versioned like a formal stable API.

Acceptance: flare classes and times match DONKI, links open the original record and the interface carries the non-operational warning.

## Registration or approval

| Source | Owner-only access step | Correct pipeline | Agent acceptance criteria |
| --- | --- | --- | --- |
| Copernicus Climate Data Store (`copernicus-cds`) | Register, accept each dataset's terms and create the current CDS personal access token | Scheduled `batch`; download bounded GRIB/NetCDF, preserve request JSON, convert selected variables to COG/Zarr | One documented dataset/variable/time window; idempotent job; raw checksum; units and model/reanalysis label; licence attached |
| Copernicus Atmosphere Data Store (`cams`) | Register, accept CAMS dataset terms and create required credentials | Scheduled `batch` plus raster serving; never request large model cubes from an interactive route | One forecast product with run time, valid time, lead time and level; no measurement language; COG/Zarr output and freshness monitor |
| Motus Wildlife Tracking (`motus`) | Create account, request project/data access and obtain written permission for intended display | Restricted `batch`; aggregate or generalize before public serving | Study permission recorded; sensitive station/animal locations reviewed; delay/generalization policy tested; revoke path documented |
| MOSDAC (`mosdac`) | Register with the official portal and request access to the chosen satellite products | Scheduled `batch` or catalog job; use documented download/service interfaces only | One named product, region and cadence; licence/attribution captured; token refresh handled; no browser automation or session-cookie scraping |
| ReliefWeb (`reliefweb`) | None for the current public adapter | Existing bounded `event` adapter | Keep query filters bounded, link every disaster record and monitor API policy changes; do not duplicate the integration |

For CDS and CAMS, the first pull request should be a tiny vertical slice, not “all climate data.” Choose one variable, geographic extent, temporal cadence and retention rule. Large multidimensional downloads need cost and quota controls before expansion.

## Mixed access by dataset or endpoint

| Source | First decision | Recommended first slice | Blocker/owner action | Done when |
| --- | --- | --- | --- | --- |
| Copernicus STAC (`copernicus-stac`) | Select a public catalog and collection; asset auth varies | Catalog search plus one cloud-optimized visual layer | Confirm collection terms and whether asset URLs require OAuth/signed URLs | Search is bounded; item datetime/cloud metadata shown; COG tile renders; asset expiry handled |
| Landsat STAC (`landsat-stac`) | Choose the authoritative catalog and collection/version | One surface-reflectance collection for historical change | Accept any account/asset terms required by the chosen endpoint | STAC item and asset provenance preserved; QA mask applied; acquisition versus processing time distinguished |
| Movebank (`movebank`) | Choose a study explicitly marked public or obtain study-owner approval | One ethically reviewed public study, aggregated in space/time | Account plus study-specific permission when required | Permission recorded; no sensitive animal identity/location exposed; removal/revocation works |
| OGD India (`ogd-india`) | Choose an exact catalog resource with a stable API | One high-value, frequently updated public dataset | Obtain resource key if required and verify reuse licence | Resource ID/version fixed; schema fixture; update lag monitored; no generic portal scraper |
| IMD (`imd`) | Select warning feed, station data or gridded product; rights differ | Official public warning/advisory feed before paid/restricted grids | Registration/licence or institutional access may be required | Official access path, redistribution rights and attribution documented; India timezone and district geometry tested |
| Bhuvan (`bhuvan`) | Choose an explicit OGC service/layer | One public WMS/WMTS layer with legend and date | Register if the selected layer requires it; verify tile reuse terms | Capabilities document pinned; CRS/legend/no-data handled; no undocumented tile scraping |
| INCOIS (`incois`) | Separate advisories from model/ocean datasets | Public tsunami/high-wave advisory events first, then one ocean field | Confirm API/feed availability and reuse conditions with INCOIS | Advisory issue/valid/expiry times modeled; coastal geometry reviewed; operational disclaimer visible |
| CPCB (`cpcb`) | Choose the official machine-readable air-quality interface | Station metadata and current AQ measurements for a bounded region | Request API/data access if the portal requires it; confirm redistribution rights | Station IDs, pollutant units, QA flags and timestamps preserved; no CAPTCHA/session bypass; overlaps with OpenAQ deduplicated |
| CWC (`cwc`) | Identify an official flood forecast/water-level feed | Published flood forecasts for a small basin set | Obtain documented access or partnership if no stable public API exists | Forecast issue/valid time and danger thresholds come from CWC; no inferred national flood status; no portal scraping |

## Secret activation checklist

For the three already-implemented credential-ready adapters:

```bash
cp .env.example .env.local
# Fill only the values you possess, then:
npm test
npm run dev
```

Smoke tests:

1. Request `/api/signals` and inspect `adapters`.
2. `openaq` or `ebird` should be `online`, not merely absent from failures.
3. Click a map coordinate and confirm `OpenTopography Terrain` becomes `online` and returns an elevation.
4. Inspect browser network requests and built client assets; none may contain a credential.
5. Remove each local key and confirm its adapter returns `unconfigured`, while all other sources continue normally.

Production activation requires the same values in the hosting environment's encrypted secret store, followed by a new deployment and the same smoke tests. Rotate immediately if any credential appears in git history or logs.

## Pull-request handoff template

Copy this into each integration pull request:

```text
Source / dataset:
Official docs and API version:
Terms reviewed on:
Authentication and secret name:
Rate limit and cache budget:
Data shape: event | probe | raster | batch
Observed time field:
Location/geometry and uncertainty:
Units and quality flags:
Licence and required attribution:
Sensitive-data decision:
Fixture date and upstream record IDs:
Failure, retry and schema-drift behavior:
Smoke-test evidence:
Rollback / disable switch:
```

An integration is not complete just because a request returns `200`. It is complete when its provenance, quality, limits, sensitivity, failure behavior and removal path are all explicit.
