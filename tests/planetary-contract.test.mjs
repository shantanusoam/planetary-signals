import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { SOURCE_REGISTRY } = await import("../lib/planetary/sources.ts");
const { CATEGORY_META } = await import("../lib/planetary/types.ts");
const { createDemoResponse } = await import("../lib/planetary/demo.ts");

test("source registry is broad, unique, and traceable", () => {
  assert.ok(SOURCE_REGISTRY.length >= 45, "expected at least 45 indexed source families");
  assert.equal(new Set(SOURCE_REGISTRY.map((source) => source.id)).size, SOURCE_REGISTRY.length);
  assert.ok(SOURCE_REGISTRY.every((source) => source.url.startsWith("https://")));
  assert.ok(SOURCE_REGISTRY.every((source) => source.license.length > 2));
  assert.ok(SOURCE_REGISTRY.filter((source) => source.integration === "connected").length >= 16);
  const credentialReady = SOURCE_REGISTRY.filter(
    (source) => source.integration === "credential-ready",
  );
  assert.ok(credentialReady.length >= 3);
  assert.ok(
    credentialReady.every(
      (source) => source.implementation && source.requiredEnv?.length,
    ),
  );
});

test("every signal category has interface metadata", () => {
  assert.deepEqual(Object.keys(CATEGORY_META).sort(), [
    "biosphere",
    "climate",
    "humanitarian",
    "infrastructure",
    "knowledge",
    "ocean",
    "seismic",
    "space",
  ]);
  for (const category of Object.values(CATEGORY_META)) {
    assert.match(category.color, /^#[0-9a-f]{6}$/i);
    assert.ok(category.label.length > 2);
  }
});

test("fallback snapshot is explicitly labeled and geographically valid", () => {
  const response = createDemoResponse();
  assert.equal(response.mode, "sample");
  assert.ok(response.signals.length >= 8);
  assert.ok(response.signals.every((signal) => signal.sample && signal.freshness === "sample"));
  for (const signal of response.signals) {
    if (signal.latitude !== undefined) assert.ok(Math.abs(signal.latitude) <= 90);
    if (signal.longitude !== undefined) assert.ok(Math.abs(signal.longitude) <= 180);
    assert.ok(!Number.isNaN(new Date(signal.observedAt).valueOf()));
  }
});

test("every connected source is represented by a server adapter or probe", async () => {
  const [signalsRoute, probeRoute] = await Promise.all([
    readFile(new URL("../app/api/signals/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/probe/route.ts", import.meta.url), "utf8"),
  ]);
  const implementation = `${signalsRoute}\n${probeRoute}`;
  const missing = SOURCE_REGISTRY
    .filter((source) => source.integration === "connected")
    .filter((source) => !implementation.includes(source.id) && source.id !== "open-meteo")
    .map((source) => source.id);
  assert.deepEqual(missing, []);
  assert.match(probeRoute, /api\.open-meteo\.com/);

  const missingCredentialAdapters = SOURCE_REGISTRY
    .filter((source) => source.integration === "credential-ready")
    .filter((source) => !implementation.includes(source.id))
    .map((source) => source.id);
  assert.deepEqual(missingCredentialAdapters, []);
  assert.match(signalsRoute, /state: "unconfigured"/);
  assert.match(signalsRoute, /latest-continuous\/items\?f=json&limit=60&datetime=\$\{dateQuery\}/);
  assert.doesNotMatch(signalsRoute, /datetime=PT6H/);
});

test("built application serves project metadata and validates probe coordinates", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const page = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, ctx);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Planetary Signals/);
  assert.doesNotMatch(html, /Starter Project/);

  const invalidProbe = await worker.fetch(new Request("http://localhost/api/probe?lat=120&lon=0"), env, ctx);
  assert.equal(invalidProbe.status, 400);
  assert.match(await invalidProbe.text(), /outside the valid Earth bounds/);
});
