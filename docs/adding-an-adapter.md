# Adding an adapter

Prefer a documented API or standard over scraping. The priority order is: API/stream, bulk download, STAC/OGC/ERDDAP/TAP/SDMX, published feed, then HTML only as a lawful last resort.

## 1. Register the source

Add a record to `lib/planetary/sources.ts`. Do not mark it `connected` until application code actually calls it.

Required decisions:

- protocol and authentication;
- cadence and geographic coverage;
- licence and commercial-use restrictions;
- whether exact coordinates are sensitive;
- which provider field represents observation time rather than publication time;
- how provider quality maps to `verified`, `reported` or `modeled`.

## 2. Add a bounded loader

Create an `AdapterDefinition` in `app/api/signals/route.ts`.

- Fetch only the slice needed by the interface.
- Use the shared timeout helper.
- Return an empty array when a successful response contains no usable records.
- Validate latitude and longitude.
- Use a stable provider ID.
- Preserve the provider record URL.
- Never leak an API key in a browser request or response.

## 3. Normalize honestly

Do not invent precision. If the provider supplies a polygon, a point used for the interface is only a display coordinate. If coordinate uncertainty is available, preserve it in `metadata`. Avoid translating unrelated domain values into one universal severity score.

## 4. Test the contract

Update `tests/planetary-contract.test.mjs`. The registry test enforces unique source IDs, HTTPS documentation URLs, licence labels and implementation coverage for connected sources.

## 5. Attribute

Add provider attribution to the README when the adapter is connected. Provider data remains governed by its own licence even though this application's code is MIT licensed.
