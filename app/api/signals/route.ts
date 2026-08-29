import { createDemoResponse } from "@/lib/planetary/demo";
import type {
  AdapterStatus,
  PlanetarySignal,
  SignalCategory,
  SignalConfidence,
  SignalsResponse,
} from "@/lib/planetary/types";

type JsonRecord = Record<string, unknown>;

const DEFAULT_HEADERS = {
  Accept: "application/json",
  "User-Agent": "PlanetarySignals/1.0 (open-source planetary data interface)",
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isoDate(value: unknown, fallback = new Date().toISOString()) {
  if (typeof value === "number" || typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return fallback;
}

function clampSeverity(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(value))) as 1 | 2 | 3 | 4 | 5;
}

function compact(value: string, max = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

async function fetchJson(url: string, timeoutMs = 5_500): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function pointFromCoordinates(value: unknown): [number, number] | undefined {
  const coordinates = array(value);
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    return [coordinates[0], coordinates[1]];
  }
  for (const coordinate of coordinates) {
    const result = pointFromCoordinates(coordinate);
    if (result) return result;
  }
  return undefined;
}

function categoryForEonet(value: string): SignalCategory {
  const category = value.toLowerCase();
  if (category.includes("volcano") || category.includes("earthquake")) return "seismic";
  if (category.includes("sea") || category.includes("ice")) return "ocean";
  if (category.includes("human")) return "humanitarian";
  return "climate";
}

interface AdapterDefinition {
  sourceId: string;
  load: () => Promise<PlanetarySignal[]>;
}

const adapters: AdapterDefinition[] = [
  {
    sourceId: "usgs-earthquakes",
    async load() {
      const payload = record(
        await fetchJson(
          "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
        ),
      );
      return array(payload.features)
        .slice(0, 90)
        .map((item, index) => {
          const feature = record(item);
          const properties = record(feature.properties);
          const geometry = record(feature.geometry);
          const coordinates = array(geometry.coordinates);
          const magnitude = number(properties.mag) ?? 0;
          const latitude = number(coordinates[1]);
          const longitude = number(coordinates[0]);
          if (latitude === undefined || longitude === undefined) return null;
          return {
            id: `usgs-${text(feature.id, String(index))}`,
            sourceId: "usgs-earthquakes",
            category: "seismic" as const,
            title: `M ${magnitude.toFixed(1)} — ${text(properties.place, "Unnamed seismic event")}`,
            summary: `${text(properties.type, "earthquake")} · ${text(properties.status, "automatic")} solution · ${number(properties.tsunami) === 1 ? "tsunami flag set" : "no tsunami flag"}`,
            observedAt: isoDate(properties.time),
            place: text(properties.place, "Location pending"),
            latitude,
            longitude,
            metric: magnitude,
            unit: text(properties.magType, "M"),
            severity: clampSeverity(magnitude < 2.5 ? 1 : magnitude - 1.1),
            confidence: (text(properties.status).toLowerCase() === "reviewed"
              ? "verified"
              : "reported") as SignalConfidence,
            freshness: "live" as const,
            sourceUrl: text(properties.url),
            metadata: {
              depthKm: number(coordinates[2]) ?? null,
              feltReports: number(properties.felt) ?? 0,
              alert: text(properties.alert, "none"),
            },
          } satisfies PlanetarySignal;
        })
        .filter((item): item is PlanetarySignal => Boolean(item));
    },
  },
  {
    sourceId: "nasa-eonet",
    async load() {
      const payload = record(
        await fetchJson("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=80&days=45"),
      );
      return array(payload.events)
        .map((item, index) => {
          const event = record(item);
          const categories = array(event.categories).map(record);
          const categoryTitle = text(categories[0]?.title, "Natural event");
          const geometries = array(event.geometry).map(record);
          const geometry = geometries.at(-1) ?? {};
          const point = pointFromCoordinates(geometry.coordinates);
          if (!point) return null;
          const sources = array(event.sources).map(record);
          return {
            id: `eonet-${text(event.id, String(index))}`,
            sourceId: "nasa-eonet",
            category: categoryForEonet(categoryTitle),
            title: text(event.title, categoryTitle),
            summary: `${categoryTitle} tracked by ${sources.length || 1} source${sources.length === 1 ? "" : "s"}. Geometry is the latest position or footprint supplied to EONET.`,
            observedAt: isoDate(geometry.date),
            place: categoryTitle,
            longitude: point[0],
            latitude: point[1],
            severity: clampSeverity(
              categoryTitle.toLowerCase().includes("severe") ||
                categoryTitle.toLowerCase().includes("volcano")
                ? 4
                : 3,
            ),
            confidence: "reported" as const,
            freshness: "nrt" as const,
            sourceUrl: text(event.link),
            metadata: { category: categoryTitle, sourceCount: sources.length },
          } satisfies PlanetarySignal;
        })
        .filter((item): item is PlanetarySignal => Boolean(item));
    },
  },
  {
    sourceId: "nws-alerts",
    async load() {
      const payload = record(
        await fetchJson("https://api.weather.gov/alerts/active?status=actual&message_type=alert"),
      );
      return array(payload.features)
        .slice(0, 70)
        .map((item, index) => {
          const feature = record(item);
          const properties = record(feature.properties);
          const geometry = record(feature.geometry);
          const point = pointFromCoordinates(geometry.coordinates);
          if (!point) return null;
          const severityName = text(properties.severity, "Unknown");
          const severity =
            severityName === "Extreme" ? 5 : severityName === "Severe" ? 4 : severityName === "Moderate" ? 3 : 2;
          return {
            id: `nws-${text(properties.id, text(feature.id, String(index)))}`,
            sourceId: "nws-alerts",
            category: "humanitarian" as const,
            title: text(properties.headline, text(properties.event, "Weather alert")),
            summary: compact(text(properties.description, text(properties.instruction, "Official active weather alert."))),
            observedAt: isoDate(properties.sent, isoDate(properties.onset)),
            place: text(properties.areaDesc, "United States"),
            longitude: point[0],
            latitude: point[1],
            severity: clampSeverity(severity),
            confidence: "verified" as const,
            freshness: "live" as const,
            sourceUrl: text(properties["@id"], text(properties.id)),
            metadata: {
              urgency: text(properties.urgency, "Unknown"),
              certainty: text(properties.certainty, "Unknown"),
              severity: severityName,
            },
          } satisfies PlanetarySignal;
        })
        .filter((item): item is PlanetarySignal => Boolean(item));
    },
  },
  {
    sourceId: "gbif",
    async load() {
      const payload = record(
        await fetchJson(
          "https://api.gbif.org/v1/occurrence/search?limit=55&hasCoordinate=true&occurrenceStatus=PRESENT&basisOfRecord=HUMAN_OBSERVATION",
        ),
      );
      return array(payload.results)
        .map((item, index) => {
          const occurrence = record(item);
          const latitude = number(occurrence.decimalLatitude);
          const longitude = number(occurrence.decimalLongitude);
          if (latitude === undefined || longitude === undefined) return null;
          const key = text(occurrence.key, String(index));
          const species = text(
            occurrence.vernacularName,
            text(occurrence.species, text(occurrence.scientificName, "Biodiversity occurrence")),
          );
          return {
            id: `gbif-${key}`,
            sourceId: "gbif",
            category: "biosphere" as const,
            title: species,
            summary: `${text(occurrence.basisOfRecord, "Occurrence").replaceAll("_", " ").toLowerCase()} · ${text(occurrence.scientificName, "taxon pending")}`,
            observedAt: isoDate(
              occurrence.eventDate,
              isoDate(occurrence.lastInterpreted),
            ),
            place: [occurrence.stateProvince, occurrence.country]
              .map((value) => text(value))
              .filter(Boolean)
              .join(", ") || "Coordinates supplied",
            latitude,
            longitude,
            severity: 1,
            confidence: "reported" as const,
            freshness: "periodic" as const,
            sourceUrl: `https://www.gbif.org/occurrence/${key}`,
            metadata: {
              dataset: text(occurrence.datasetTitle, "GBIF occurrence"),
              coordinateUncertaintyM: number(occurrence.coordinateUncertaintyInMeters) ?? null,
            },
          } satisfies PlanetarySignal;
        })
        .filter((item): item is PlanetarySignal => Boolean(item));
    },
  },
  {
    sourceId: "inaturalist",
    async load() {
      const payload = record(
        await fetchJson(
          "https://api.inaturalist.org/v1/observations?per_page=55&order_by=created_at&order=desc&geo=true&quality_grade=research",
        ),
      );
      return array(payload.results)
        .map((item, index) => {
          const observation = record(item);
          const taxon = record(observation.taxon);
          const location = text(observation.location).split(",").map(Number);
          const latitude = number(location[0]);
          const longitude = number(location[1]);
          if (latitude === undefined || longitude === undefined) return null;
          const taxonName = text(
            taxon.preferred_common_name,
            text(taxon.name, "Community biodiversity observation"),
          );
          return {
            id: `inat-${text(observation.id, String(index))}`,
            sourceId: "inaturalist",
            category: "biosphere" as const,
            title: taxonName,
            summary: `${text(taxon.name, "Taxon pending")} · ${text(observation.quality_grade, "community")} grade`,
            observedAt: isoDate(observation.observed_on, isoDate(observation.created_at)),
            place: text(observation.place_guess, "Observer-provided coordinates"),
            latitude,
            longitude,
            severity: 1,
            confidence: "reported" as const,
            freshness: "nrt" as const,
            sourceUrl: text(observation.uri),
            metadata: {
              iconicTaxon: text(taxon.iconic_taxon_name, "Life"),
              captive: Boolean(observation.captive),
            },
          } satisfies PlanetarySignal;
        })
        .filter((item): item is PlanetarySignal => Boolean(item));
    },
  },
  {
    sourceId: "obis",
    async load() {
      const payload = record(await fetchJson("https://api.obis.org/v3/occurrence?size=55"));
      const results = array(payload.results).length ? array(payload.results) : array(payload.data);
      return results
        .map((item, index) => {
          const occurrence = record(item);
          const latitude = number(occurrence.decimalLatitude);
          const longitude = number(occurrence.decimalLongitude);
          if (latitude === undefined || longitude === undefined) return null;
          const id = text(occurrence.id, text(occurrence.occurrenceID, String(index)));
          return {
            id: `obis-${id}`,
            sourceId: "obis",
            category: "ocean" as const,
            title: text(occurrence.scientificName, "Marine occurrence"),
            summary: `${text(occurrence.basisOfRecord, "Marine record")} · ${text(occurrence.datasetName, "OBIS network")}`,
            observedAt: isoDate(occurrence.eventDate, isoDate(occurrence.dateIdentified)),
            place: text(occurrence.waterBody, text(occurrence.locality, "Global ocean")),
            latitude,
            longitude,
            severity: 1,
            confidence: "reported" as const,
            freshness: "periodic" as const,
            sourceUrl: `https://obis.org/occurrence/${encodeURIComponent(id)}`,
            metadata: { depthM: number(occurrence.depth) ?? null },
          } satisfies PlanetarySignal;
        })
        .filter((item): item is PlanetarySignal => Boolean(item));
    },
  },
  {
    sourceId: "swpc",
    async load() {
      const payload = array(
        await fetchJson("https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json"),
      ).map(record);
      const latest = payload
        .filter((entry) => text(entry.energy).includes("0.1-0.8"))
        .at(-1) ?? payload.at(-1);
      if (!latest) return [];
      const flux = number(latest.flux) ?? 0;
      const solarClass = flux >= 1e-4 ? "X-class range" : flux >= 1e-5 ? "M-class range" : flux >= 1e-6 ? "C-class range" : "quiet range";
      return [
        {
          id: `swpc-xray-${isoDate(latest.time_tag)}`,
          sourceId: "swpc",
          category: "space",
          title: `Solar X-ray flux — ${solarClass}`,
          summary: `GOES ${text(latest.satellite, "primary")} · ${text(latest.energy, "0.1–0.8 nm")} channel`,
          observedAt: isoDate(latest.time_tag),
          metric: flux,
          unit: "W/m²",
          severity: clampSeverity(flux >= 1e-4 ? 5 : flux >= 1e-5 ? 4 : flux >= 1e-6 ? 3 : 1),
          confidence: "verified",
          freshness: "live",
          sourceUrl: "https://www.swpc.noaa.gov/products/goes-x-ray-flux",
          metadata: { energy: text(latest.energy), satellite: text(latest.satellite) },
        },
      ];
    },
  },
  {
    sourceId: "reliefweb",
    async load() {
      const payload = record(
        await fetchJson(
          "https://api.reliefweb.int/v1/disasters?appname=planetary-signals&limit=30&profile=full&preset=latest",
        ),
      );
      return array(payload.data).slice(0, 20).map((item, index) => {
        const wrapper = record(item);
        const fields = record(wrapper.fields);
        const date = record(fields.date);
        const primaryCountry = record(fields.primary_country);
        const location = record(primaryCountry.location);
        const types = array(fields.type).map(record);
        const status = text(fields.status, "Alert");
        return {
          id: `reliefweb-${text(wrapper.id, String(index))}`,
          sourceId: "reliefweb",
          category: "humanitarian" as const,
          title: text(fields.name, "Humanitarian disaster record"),
          summary: `${types.map((type) => text(type.name)).filter(Boolean).join(", ") || "Disaster"} · ${status}`,
          observedAt: isoDate(date.created, isoDate(date.changed)),
          place: text(primaryCountry.name, "Multiple countries"),
          latitude: number(location.lat),
          longitude: number(location.lon),
          severity: status.toLowerCase().includes("alert") ? 4 : 3,
          confidence: "verified" as const,
          freshness: "nrt" as const,
          sourceUrl: text(fields.url_alias, text(fields.url)),
          metadata: { status, countries: array(fields.country).length },
        } satisfies PlanetarySignal;
      });
    },
  },
  {
    sourceId: "nasa-cmr",
    async load() {
      const payload = record(
        await fetchJson(
          "https://cmr.earthdata.nasa.gov/search/collections.json?page_size=8&sort_key=-start_date",
        ),
      );
      const entries = array(record(payload.feed).entry).map(record);
      return entries.slice(0, 6).map((entry, index) => ({
        id: `cmr-${text(entry.id, String(index))}`,
        sourceId: "nasa-cmr",
        category: "knowledge" as const,
        title: text(entry.title, "NASA Earth science collection"),
        summary: compact(text(entry.summary, "New or updated Earthdata collection.")),
        observedAt: isoDate(entry.updated),
        severity: 1 as const,
        confidence: "verified" as const,
        freshness: "periodic" as const,
        sourceUrl: text(entry.link),
        metadata: { datasetId: text(entry.dataset_id), archiveCenter: text(entry.archive_center) },
      }));
    },
  },
  {
    sourceId: "openalex",
    async load() {
      const payload = record(
        await fetchJson(
          "https://api.openalex.org/works?search=planetary%20climate%20biodiversity&per-page=8&sort=publication_date:desc",
        ),
      );
      return array(payload.results).slice(0, 7).map((item, index) => {
        const work = record(item);
        const primaryLocation = record(work.primary_location);
        const source = record(primaryLocation.source);
        return {
          id: `openalex-${text(work.id, String(index)).split("/").at(-1)}`,
          sourceId: "openalex",
          category: "knowledge" as const,
          title: text(work.display_name, "New planetary research"),
          summary: `${text(source.display_name, "Research source")} · ${number(work.cited_by_count) ?? 0} citations`,
          observedAt: isoDate(work.publication_date, isoDate(work.updated_date)),
          severity: 1 as const,
          confidence: "reported" as const,
          freshness: "periodic" as const,
          sourceUrl: text(work.doi, text(work.id)),
          metadata: { citations: number(work.cited_by_count) ?? 0, openAccess: Boolean(record(work.open_access).is_oa) },
        } satisfies PlanetarySignal;
      });
    },
  },
  {
    sourceId: "world-bank",
    async load() {
      const payload = array(
        await fetchJson(
          "https://api.worldbank.org/v2/country/WLD/indicator/SP.POP.TOTL?format=json&per_page=4",
        ),
      );
      const latest = array(payload[1]).map(record).find((entry) => number(entry.value) !== undefined);
      if (!latest) return [];
      return [
        {
          id: `world-bank-population-${text(latest.date)}`,
          sourceId: "world-bank",
          category: "humanitarian",
          title: "World population indicator updated",
          summary: `Latest published World Development Indicators value for ${text(latest.date, "latest year")}.`,
          observedAt: isoDate(`${text(latest.date, "2024")}-12-31`),
          metric: number(latest.value),
          unit: "people",
          severity: 1,
          confidence: "verified",
          freshness: "periodic",
          sourceUrl: "https://data.worldbank.org/indicator/SP.POP.TOTL",
          metadata: { year: text(latest.date), estimate: true },
        },
      ];
    },
  },
  {
    sourceId: "ripe-atlas",
    async load() {
      const payload = record(
        await fetchJson("https://atlas.ripe.net/api/v2/measurements/?status=2&page_size=1"),
      );
      const count = number(payload.count) ?? 0;
      return [
        {
          id: `ripe-active-${count}`,
          sourceId: "ripe-atlas",
          category: "infrastructure",
          title: `${count.toLocaleString("en-US")} active Internet measurements`,
          summary: "Distributed ping, traceroute, DNS and network observations currently indexed by RIPE Atlas.",
          observedAt: new Date().toISOString(),
          metric: count,
          unit: "measurements",
          severity: 1,
          confidence: "verified",
          freshness: "live",
          sourceUrl: "https://atlas.ripe.net/measurements/",
        },
      ];
    },
  },
];

async function runAdapter(definition: AdapterDefinition): Promise<{
  signals: PlanetarySignal[];
  status: AdapterStatus;
}> {
  const startedAt = Date.now();
  try {
    const signals = await definition.load();
    return {
      signals,
      status: {
        sourceId: definition.sourceId,
        state: signals.length ? "online" : "degraded",
        records: signals.length,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        ...(signals.length ? {} : { error: "Source returned no usable records" }),
      },
    };
  } catch (error) {
    return {
      signals: [],
      status: {
        sourceId: definition.sourceId,
        state: "offline",
        records: 0,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? compact(error.message, 90) : "Adapter failed",
      },
    };
  }
}

export async function GET() {
  const results = await Promise.all(adapters.map(runAdapter));
  const adaptersStatus = results.map((result) => result.status);
  const liveSignals = results.flatMap((result) => result.signals);
  const onlineCount = adaptersStatus.filter((adapter) => adapter.state === "online").length;
  const demo = createDemoResponse();

  let mode: SignalsResponse["mode"] = "live";
  let signals = liveSignals;

  if (onlineCount === 0 || liveSignals.length === 0) {
    mode = "sample";
    signals = demo.signals;
  } else if (onlineCount < adapters.length) {
    mode = "partial";
    if (liveSignals.length < 8) {
      const onlineSources = new Set(adaptersStatus.filter((item) => item.state === "online").map((item) => item.sourceId));
      signals = [
        ...liveSignals,
        ...demo.signals.filter((signal) => !onlineSources.has(signal.sourceId)),
      ];
    }
  }

  signals = signals
    .sort((a, b) => new Date(b.observedAt).valueOf() - new Date(a.observedAt).valueOf())
    .slice(0, 280);

  const response: SignalsResponse = {
    generatedAt: new Date().toISOString(),
    mode,
    signals,
    adapters: adaptersStatus,
  };

  return Response.json(response, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=180, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
