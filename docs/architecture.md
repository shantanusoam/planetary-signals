# Architecture

Planetary Signals is intentionally a federation, not a warehouse. The first release requests bounded slices from public providers at read time, normalizes them for display and preserves the original record URL.

## Request path

1. `/api/signals` starts all adapters concurrently.
2. Each adapter has a short timeout and returns its own health result.
3. Provider payloads become `PlanetarySignal` records.
4. The response is sorted by observation time and capped before reaching the browser.
5. The client filters locally by category and time window.
6. MapLibre clusters only records with valid coordinates; nonspatial records remain in the field log.

This keeps a slow biodiversity API from blocking a fast earthquake feed and lets the interface accurately report a partial mesh.

## Observation envelope

The shared fields answer a small set of questions:

- What happened?
- Where and when was it observed?
- Which provider made it available?
- How fresh is it?
- Is it verified, reported or modeled?
- Where can someone inspect the original record?

Domain-specific values stay inside `metadata`. The gateway does not pretend earthquake magnitude and air quality have comparable severity semantics.

## Failure modes

| Condition | Behaviour |
| --- | --- |
| Every adapter responds | `mode: live` |
| At least one adapter fails | `mode: partial`; successful records remain live |
| All adapters fail | `mode: sample`; clearly labeled demonstration records render |
| One probe source fails | Other probe domains remain visible and the source strip marks it offline |
| Invalid coordinates | `400` before any upstream request |

## Caching

Signal responses are cacheable for one minute in the browser and three minutes at an edge cache, with stale-while-revalidate. Planet probes use a five-minute shared cache because forecasts and air models do not need per-second retrieval.

## Production evolution

For a sustained high-volume service, move from request-time federation to scheduled ingestion:

```text
REST / STAC / OGC / TAP / ERDDAP / streams
                    ↓
              Source adapters
                    ↓
       Immutable raw objects + event bus
                    ↓
       QC, unit validation and normalization
                    ↓
       GeoParquet / COG / Zarr / PostGIS
                    ↓
           API, vector tiles and alerts
```

The source registry should stay authoritative through that transition. It must record authentication, geographic coverage, update cadence, latency, licence, attribution, commercial-use status, sensitivity and a sample query.
