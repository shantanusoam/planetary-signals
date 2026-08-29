export type SignalCategory =
  | "seismic"
  | "climate"
  | "biosphere"
  | "ocean"
  | "humanitarian"
  | "space"
  | "knowledge"
  | "infrastructure";

export type SignalConfidence = "verified" | "reported" | "modeled";
export type SignalFreshness = "live" | "nrt" | "periodic" | "archive" | "sample";

export interface PlanetarySignal {
  id: string;
  sourceId: string;
  category: SignalCategory;
  title: string;
  summary: string;
  observedAt: string;
  place?: string;
  latitude?: number;
  longitude?: number;
  metric?: number;
  unit?: string;
  severity: 1 | 2 | 3 | 4 | 5;
  confidence: SignalConfidence;
  freshness: SignalFreshness;
  sourceUrl?: string;
  sample?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AdapterStatus {
  sourceId: string;
  state: "online" | "degraded" | "offline";
  records: number;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

export interface SignalsResponse {
  generatedAt: string;
  mode: "live" | "partial" | "sample";
  signals: PlanetarySignal[];
  adapters: AdapterStatus[];
}

export type SourceDomain =
  | "Earth systems"
  | "Climate & air"
  | "Oceans & water"
  | "Living systems"
  | "Disasters & society"
  | "Space & astronomy"
  | "Knowledge & infrastructure"
  | "India";

export interface SourceRegistryEntry {
  id: string;
  name: string;
  provider: string;
  domain: SourceDomain;
  protocol: string;
  auth: "None" | "Free key" | "Registration" | "Mixed";
  cadence: SignalFreshness;
  coverage: string;
  license: string;
  integration: "connected" | "catalogued" | "key-needed";
  url: string;
  description: string;
}

export const CATEGORY_META: Record<
  SignalCategory,
  { label: string; color: string; description: string }
> = {
  seismic: {
    label: "Seismic",
    color: "#ff6b4a",
    description: "Earthquakes and crustal motion",
  },
  climate: {
    label: "Climate",
    color: "#f6bf54",
    description: "Weather, fire and atmospheric events",
  },
  biosphere: {
    label: "Biosphere",
    color: "#74e39a",
    description: "Species and ecological observations",
  },
  ocean: {
    label: "Ocean",
    color: "#52c7e8",
    description: "Marine life and ocean conditions",
  },
  humanitarian: {
    label: "Human",
    color: "#ff8fc7",
    description: "Alerts, disasters and communities",
  },
  space: {
    label: "Space",
    color: "#a892ff",
    description: "Solar and near-Earth environment",
  },
  knowledge: {
    label: "Knowledge",
    color: "#d5e2ee",
    description: "Research and planetary memory",
  },
  infrastructure: {
    label: "Networks",
    color: "#b9f269",
    description: "Internet and civic infrastructure",
  },
};
