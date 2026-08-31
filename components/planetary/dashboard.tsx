"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Atom,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  CloudSun,
  Database,
  Dna,
  ExternalLink,
  Filter,
  Gauge,
  Globe2,
  HeartPulse,
  Info,
  Layers3,
  MapPinned,
  Network,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Sunrise,
  Sunset,
  Thermometer,
  Waves,
  Wind,
  X,
  Zap,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { createDemoResponse } from "@/lib/planetary/demo";
import { SOURCE_REGISTRY } from "@/lib/planetary/sources";
import {
  CATEGORY_META,
  type PlanetarySignal,
  type SignalCategory,
  type SignalsResponse,
  type SourceRegistryEntry,
} from "@/lib/planetary/types";

import { SignalMap } from "./signal-map";

const categoryIcons: Record<SignalCategory, typeof Activity> = {
  seismic: Activity,
  climate: CloudSun,
  biosphere: Dna,
  ocean: Waves,
  humanitarian: HeartPulse,
  space: Sparkles,
  knowledge: BookOpen,
  infrastructure: Network,
};

const domainColors: Record<SourceRegistryEntry["domain"], string> = {
  "Earth systems": "#ff7659",
  "Climate & air": "#f6bf54",
  "Oceans & water": "#52c7e8",
  "Living systems": "#74e39a",
  "Disasters & society": "#ff8fc7",
  "Space & astronomy": "#a892ff",
  "Knowledge & infrastructure": "#d5e2ee",
  India: "#ffb169",
};

const integrationLabels = {
  connected: "Live adapter",
  "credential-ready": "Credential ready",
  catalogued: "Registry ready",
  "key-needed": "Key / account",
} as const;

const timeRanges = [
  { value: "24", label: "Last 24 hours" },
  { value: "168", label: "Last 7 days" },
  { value: "1080", label: "Last 45 days" },
  { value: "all", label: "All available" },
];

interface PlanetaryDashboardProps {
  initialData?: SignalsResponse;
}

interface ProbeResponse {
  generatedAt: string;
  coordinates: { latitude: number; longitude: number };
  location: { label: string; region: string | null; country: string | null; timezone: string | null };
  weather: null | {
    observedAt: string | null;
    temperature: number | null;
    apparentTemperature: number | null;
    humidity: number | null;
    precipitation: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    weatherCode: number | null;
    sunrise: string | null;
    sunset: string | null;
    units: Record<string, string | null>;
  };
  air: null | {
    observedAt: string | null;
    usAqi: number | null;
    europeanAqi: number | null;
    pm25: number | null;
    pm10: number | null;
    ozone: number | null;
    nitrogenDioxide: number | null;
    units: Record<string, string | null>;
  };
  marine: null | {
    observedAt: string | null;
    waveHeight: number | null;
    waveDirection: number | null;
    wavePeriod: number | null;
    windWaveHeight: number | null;
    swellWaveHeight: number | null;
    seaSurfaceTemperature: number | null;
    units: Record<string, string | null>;
  };
  terrain: null | {
    elevation: number | null;
    unit: string | null;
    dataset: string | null;
    verticalDatum: string | null;
  };
  sources: Array<{
    sourceId: string;
    name: string;
    state: "online" | "offline" | "unconfigured";
    latencyMs: number;
    error: string | null;
  }>;
}

export function PlanetaryDashboard({ initialData }: PlanetaryDashboardProps) {
  const [data, setData] = useState<SignalsResponse>(initialData ?? createDemoResponse());
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<SignalCategory>>(
    new Set(Object.keys(CATEGORY_META) as SignalCategory[]),
  );
  const [timeRange, setTimeRange] = useState("1080");
  const [selectedSignal, setSelectedSignal] = useState<PlanetarySignal | null>(null);
  const [probePoint, setProbePoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [probeData, setProbeData] = useState<ProbeResponse | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState("field");
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryFilter, setRegistryFilter] = useState<"all" | SourceRegistryEntry["integration"]>("all");

  const loadSignals = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/signals", { cache: "no-store" });
      if (!response.ok) throw new Error(`Signal gateway returned ${response.status}`);
      const payload = (await response.json()) as SignalsResponse;
      setData(payload);
      setLastError(null);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Live gateway unavailable");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  const inspectPoint = useCallback(async (point: { latitude: number; longitude: number }) => {
    setProbePoint(point);
    setProbeData(null);
    setProbeError(null);
    setProbeLoading(true);
    try {
      const query = new URLSearchParams({
        lat: point.latitude.toFixed(5),
        lon: point.longitude.toFixed(5),
      });
      const response = await fetch(`/api/probe?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Probe gateway returned ${response.status}`);
      setProbeData((await response.json()) as ProbeResponse);
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : "Unable to inspect this location");
    } finally {
      setProbeLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadSignals(), 0);
    const interval = window.setInterval(() => void loadSignals(), 180_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadSignals]);

  const filteredSignals = useMemo(() => {
    const cutoff =
      timeRange === "all" ? 0 : new Date(data.generatedAt).valueOf() - Number(timeRange) * 60 * 60 * 1_000;
    return data.signals.filter(
      (signal) =>
        selectedCategories.has(signal.category) &&
        (cutoff === 0 || new Date(signal.observedAt).valueOf() >= cutoff),
    );
  }, [data.generatedAt, data.signals, selectedCategories, timeRange]);

  const categoryCounts = useMemo(
    () =>
      data.signals.reduce<Record<SignalCategory, number>>(
        (counts, signal) => ({ ...counts, [signal.category]: counts[signal.category] + 1 }),
        {
          seismic: 0,
          climate: 0,
          biosphere: 0,
          ocean: 0,
          humanitarian: 0,
          space: 0,
          knowledge: 0,
          infrastructure: 0,
        },
      ),
    [data.signals],
  );

  const onlineAdapters = data.adapters.filter((adapter) => adapter.state === "online");
  const configuredAdapters = data.adapters.filter(
    (adapter) => adapter.state !== "unconfigured",
  );
  const readyAdapters = data.adapters.filter(
    (adapter) => adapter.state === "unconfigured",
  );
  const mappedCount = filteredSignals.filter(
    (signal) => signal.latitude !== undefined && signal.longitude !== undefined,
  ).length;
  const medianLatency = median(onlineAdapters.map((adapter) => adapter.latencyMs));
  const newestSignal = filteredSignals[0];

  const toggleCategory = (category: SignalCategory) => {
    setSelectedCategories((current) => {
      const next = new Set(current);
      if (next.has(category) && next.size > 1) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const registryResults = useMemo(() => {
    const query = registryQuery.trim().toLowerCase();
    return SOURCE_REGISTRY.filter((source) => {
      const matchesFilter = registryFilter === "all" || source.integration === registryFilter;
      const matchesQuery =
        !query ||
        [source.name, source.provider, source.domain, source.protocol, source.coverage]
          .join(" ")
          .toLowerCase()
          .includes(query);
      return matchesFilter && matchesQuery;
    });
  }, [registryFilter, registryQuery]);

  return (
    <TooltipProvider delayDuration={120}>
      <main className="planetary-app">
        <Tabs value={activeView} onValueChange={setActiveView} className="planetary-tabs">
          <header className="app-header">
            <div className="brand-lockup">
              <span className="brand-mark" aria-hidden="true">
                <i />
              </span>
              <div>
                <strong>Planetary Signals</strong>
                <span>Open-data observatory</span>
              </div>
            </div>

            <TabsList variant="line" className="view-tabs" aria-label="Primary views">
              <TabsTrigger value="field">
                <Globe2 /> Signal field
              </TabsTrigger>
              <TabsTrigger value="sources">
                <Database /> Source atlas
              </TabsTrigger>
            </TabsList>

            <div className="header-status">
              <div className={`mode-badge mode-${data.mode}`}>
                <span />
                {data.mode === "live" ? "Live mesh" : data.mode === "partial" ? "Partial mesh" : "Sample mode"}
              </div>
              <div className="sync-copy">
                <span>Synced</span>
                <strong>{relativeTime(data.generatedAt)}</strong>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void loadSignals(true)}
                    aria-label="Refresh signals"
                    disabled={refreshing}
                  >
                    <RefreshCw className={refreshing ? "spin" : ""} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Refresh all adapters</TooltipContent>
              </Tooltip>
            </div>
          </header>

          <TabsContent value="field" className="field-view">
            {lastError && (
              <div className="gateway-notice" role="status">
                <CircleAlert /> Live refresh paused. Showing the latest available snapshot.
              </div>
            )}

            <section className="telemetry-strip" aria-label="Live telemetry summary">
              <TelemetryMetric icon={Radio} label="Visible signals" value={formatNumber(filteredSignals.length)} detail={`${mappedCount} geolocated`} />
              <TelemetryMetric icon={Zap} label="Adapters online" value={`${onlineAdapters.length}/${configuredAdapters.length}`} detail={readyAdapters.length ? `${readyAdapters.length} await credentials` : data.mode === "live" ? "full mesh" : "graceful fallback"} />
              <TelemetryMetric icon={Gauge} label="Median response" value={medianLatency ? `${medianLatency} ms` : "—"} detail="last gateway pulse" />
              <TelemetryMetric icon={Activity} label="Newest observation" value={newestSignal ? relativeTime(newestSignal.observedAt) : "—"} detail={newestSignal?.sourceId ?? "waiting"} />
            </section>

            <div className="field-grid">
              <aside className="filter-rail" aria-label="Signal filters">
                <div className="panel-heading">
                  <span>Layers</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCategories(new Set(Object.keys(CATEGORY_META) as SignalCategory[]))}
                  >
                    All on
                  </button>
                </div>

                <div className="category-list">
                  {(Object.entries(CATEGORY_META) as Array<[SignalCategory, (typeof CATEGORY_META)[SignalCategory]]>).map(
                    ([category, meta]) => {
                      const Icon = categoryIcons[category];
                      const active = selectedCategories.has(category);
                      return (
                        <button
                          key={category}
                          type="button"
                          className={`category-control ${active ? "active" : ""}`}
                          onClick={() => toggleCategory(category)}
                          aria-pressed={active}
                        >
                          <span className="category-icon" style={{ color: meta.color, backgroundColor: `${meta.color}16` }}>
                            <Icon />
                          </span>
                          <span>
                            <strong>{meta.label}</strong>
                            <small>{meta.description}</small>
                          </span>
                          <b>{categoryCounts[category]}</b>
                        </button>
                      );
                    },
                  )}
                </div>

                <div className="rail-section time-section">
                  <label htmlFor="time-range">Observation window</label>
                  <Select value={timeRange} onValueChange={setTimeRange}>
                    <SelectTrigger id="time-range" className="time-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {timeRanges.map((range) => (
                        <SelectItem key={range.value} value={range.value}>
                          {range.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rail-section integrity-panel">
                  <div className="section-title">
                    <span>Signal integrity</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label="About signal integrity">
                          <Info />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">
                        Provider review status is preserved. Citizen observations and models are never presented as equivalent to calibrated instruments.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {(["verified", "reported", "modeled"] as const).map((confidence) => {
                    const count = filteredSignals.filter((signal) => signal.confidence === confidence).length;
                    const ratio = filteredSignals.length ? (count / filteredSignals.length) * 100 : 0;
                    return (
                      <div className="integrity-row" key={confidence}>
                        <span>{confidence}</span>
                        <i><b style={{ width: `${ratio}%` }} /></i>
                        <strong>{count}</strong>
                      </div>
                    );
                  })}
                </div>

                <div className="rail-section adapter-panel">
                  <div className="section-title">
                    <span>Adapter mesh</span>
                    <button type="button" onClick={() => setActiveView("sources")}>
                      View all <ChevronRight />
                    </button>
                  </div>
                  {data.adapters.slice(0, 6).map((adapter) => (
                    <div className="adapter-row" key={adapter.sourceId}>
                      <span className={`adapter-dot ${adapter.state}`} />
                      <span>{sourceName(adapter.sourceId)}</span>
                      <b>{adapter.records || "—"}</b>
                    </div>
                  ))}
                </div>
              </aside>

              <section className="map-stage" aria-label="Planetary signal map">
                <div className="map-titlebar">
                  <div>
                    <span>Global field</span>
                    <strong>{formatNumber(mappedCount)} spatial observations</strong>
                  </div>
                  <div className="map-title-meta">
                    <span><MapPinned /> Coordinates preserved</span>
                    <span><ShieldCheck /> Provenance attached</span>
                  </div>
                </div>
                <SignalMap
                  signals={filteredSignals}
                  selectedId={selectedSignal?.id ?? null}
                  onSelect={setSelectedSignal}
                  probePoint={probePoint}
                  onInspect={inspectPoint}
                />
                {selectedSignal && (
                  <SignalDetail signal={selectedSignal} onClose={() => setSelectedSignal(null)} />
                )}
                {!selectedSignal && probePoint && (
                  <ProbeCard
                    point={probePoint}
                    data={probeData}
                    loading={probeLoading}
                    error={probeError}
                    onClose={() => {
                      setProbePoint(null);
                      setProbeData(null);
                      setProbeError(null);
                    }}
                  />
                )}
              </section>

              <aside className="timeline-panel" aria-label="Latest signal timeline">
                <div className="timeline-heading">
                  <div>
                    <span>Field log</span>
                    <strong>What changed</strong>
                  </div>
                  <span className="timeline-count">{filteredSignals.length}</span>
                </div>
                <div className="timeline-list">
                  {filteredSignals.length ? (
                    filteredSignals.slice(0, 34).map((signal, index) => (
                      <TimelineCard
                        key={signal.id}
                        signal={signal}
                        active={selectedSignal?.id === signal.id}
                        first={index === 0}
                        onClick={() => setSelectedSignal(signal)}
                      />
                    ))
                  ) : (
                    <div className="empty-state">
                      <Filter />
                      <strong>No signals in this window</strong>
                      <span>Expand the time range or enable another layer.</span>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </TabsContent>

          <TabsContent value="sources" className="sources-view">
            <section className="atlas-intro">
              <div>
                <span className="eyebrow"><Layers3 /> Source registry</span>
                <h1>A map is only as trustworthy as its sources.</h1>
                <p>
                  {SOURCE_REGISTRY.length} planetary data systems indexed by protocol, access,
                  cadence, coverage and licence. Live adapters share one observation envelope;
                  every domain-specific payload keeps its original provenance.
                </p>
              </div>
              <div className="atlas-stats">
                <div><strong>{SOURCE_REGISTRY.filter((source) => source.integration === "connected").length}</strong><span>connected</span></div>
                <div><strong>{SOURCE_REGISTRY.filter((source) => source.integration === "credential-ready").length}</strong><span>credential ready</span></div>
                <div><strong>{new Set(SOURCE_REGISTRY.map((source) => source.domain)).size}</strong><span>signal domains</span></div>
              </div>
            </section>

            <section className="adapter-flow" aria-label="Data adapter architecture">
              <div><Radio /><span>Open signals</span><small>REST · STAC · OGC · TAP · ERDDAP</small></div>
              <ChevronRight />
              <div><Atom /><span>Source adapters</span><small>validate · normalize · preserve raw</small></div>
              <ChevronRight />
              <div><ShieldCheck /><span>Observation envelope</span><small>time · place · quality · licence</small></div>
              <ChevronRight />
              <div><Globe2 /><span>Living interface</span><small>map · timeline · provenance</small></div>
            </section>

            <section className="registry-toolbar">
              <label className="registry-search">
                <Search />
                <input
                  value={registryQuery}
                  onChange={(event) => setRegistryQuery(event.target.value)}
                  placeholder="Search provider, protocol, domain or region…"
                  aria-label="Search source registry"
                />
                {registryQuery && (
                  <button type="button" onClick={() => setRegistryQuery("")} aria-label="Clear source search">
                    <X />
                  </button>
                )}
              </label>
              <div className="registry-filters" aria-label="Filter source integrations">
                {(["all", "connected", "credential-ready", "catalogued", "key-needed"] as const).map((filter) => (
                  <button
                    type="button"
                    key={filter}
                    onClick={() => setRegistryFilter(filter)}
                    className={registryFilter === filter ? "active" : ""}
                    aria-pressed={registryFilter === filter}
                  >
                    {filter === "all" ? "All sources" : integrationLabels[filter]}
                  </button>
                ))}
              </div>
              <span className="registry-total">{registryResults.length} found</span>
            </section>

            <section className="source-grid">
              {registryResults.map((source) => (
                <SourceCard key={source.id} source={source} />
              ))}
            </section>

            {!registryResults.length && (
              <div className="registry-empty">
                <Search />
                <strong>No matching source</strong>
                <span>Try a provider, protocol such as STAC, or a region such as India.</span>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </TooltipProvider>
  );
}

function TelemetryMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="telemetry-metric">
      <span className="telemetry-icon"><Icon /></span>
      <span><small>{label}</small><strong>{value}</strong></span>
      <em>{detail}</em>
    </div>
  );
}

function TimelineCard({
  signal,
  active,
  first,
  onClick,
}: {
  signal: PlanetarySignal;
  active: boolean;
  first: boolean;
  onClick: () => void;
}) {
  const meta = CATEGORY_META[signal.category];
  return (
    <button type="button" className={`timeline-card ${active ? "active" : ""}`} onClick={onClick}>
      <span className="timeline-track">
        <i style={{ backgroundColor: meta.color, boxShadow: `0 0 0 4px ${meta.color}19` }} />
        {!first && <b />}
      </span>
      <span className="timeline-content">
        <span className="timeline-meta">
          <em style={{ color: meta.color }}>{meta.label}</em>
          <time>{relativeTime(signal.observedAt)}</time>
          {signal.sample && <b>sample</b>}
        </span>
        <strong>{signal.title}</strong>
        <span>{signal.place ?? signal.summary}</span>
        <small>
          {sourceName(signal.sourceId)}
          <i>·</i>
          {signal.confidence}
        </small>
      </span>
    </button>
  );
}

function SignalDetail({ signal, onClose }: { signal: PlanetarySignal; onClose: () => void }) {
  const meta = CATEGORY_META[signal.category];
  return (
    <article className="signal-detail-card">
      <div className="signal-detail-top">
        <span className="signal-kind" style={{ color: meta.color }}>
          <i style={{ backgroundColor: meta.color }} /> {meta.label}
        </span>
        <button type="button" onClick={onClose} aria-label="Close signal details"><X /></button>
      </div>
      <h2>{signal.title}</h2>
      <p>{signal.summary}</p>
      <div className="detail-facts">
        <span><small>Observed</small><strong>{formatDate(signal.observedAt)}</strong></span>
        <span><small>Source</small><strong>{sourceName(signal.sourceId)}</strong></span>
        <span><small>Quality</small><strong>{signal.confidence}</strong></span>
        <span><small>Freshness</small><strong>{signal.sample ? "sample" : signal.freshness}</strong></span>
      </div>
      {signal.sourceUrl && (
        <a href={signal.sourceUrl} target="_blank" rel="noreferrer">
          Inspect original record <ArrowUpRight />
        </a>
      )}
    </article>
  );
}

function ProbeCard({
  point,
  data,
  loading,
  error,
  onClose,
}: {
  point: { latitude: number; longitude: number };
  data: ProbeResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const weather = data?.weather;
  const air = data?.air;
  const marine = data?.marine;
  const terrain = data?.terrain;
  const title = data?.location.label ?? coordinateLabel(point.latitude, point.longitude);
  return (
    <article className="probe-card">
      <div className="signal-detail-top">
        <span className="signal-kind probe-kind"><MapPinned /> Planet probe</span>
        <button type="button" onClick={onClose} aria-label="Close planet probe"><X /></button>
      </div>
      <h2 title={title}>{title}</h2>
      <span className="probe-coordinates">
        {point.latitude.toFixed(4)}, {point.longitude.toFixed(4)}
        {data?.location.timezone ? ` · ${data.location.timezone}` : ""}
      </span>

      {loading && (
        <div className="probe-loading" role="status">
          <span><i /><i /><i /></span>
          <strong>Combining local open data</strong>
          <small>Forecast · air · marine · place · optional terrain</small>
        </div>
      )}

      {error && !loading && (
        <div className="probe-error"><CircleAlert /> {error}</div>
      )}

      {data && !loading && (
        <>
          <div className="probe-summary">
            <div>
              <CloudSun />
              <span><small>Conditions</small><strong>{weatherCodeLabel(weather?.weatherCode ?? null)}</strong></span>
            </div>
            <div>
              <Thermometer />
              <span><small>Temperature</small><strong>{metric(weather?.temperature, weather?.units.temperature, "—")}</strong></span>
            </div>
            <div>
              <Wind />
              <span><small>Wind</small><strong>{metric(weather?.windSpeed, weather?.units.windSpeed, "—")}</strong></span>
            </div>
            <div>
              <HeartPulse />
              <span><small>US AQI</small><strong className={aqiClass(air?.usAqi)}>{air?.usAqi ?? "—"}</strong></span>
            </div>
          </div>

          <div className="probe-domains">
            <section>
              <span><CloudSun /> Atmosphere</span>
              <dl>
                <div><dt>Feels like</dt><dd>{metric(weather?.apparentTemperature, weather?.units.temperature)}</dd></div>
                <div><dt>Humidity</dt><dd>{metric(weather?.humidity, weather?.units.humidity)}</dd></div>
                <div><dt>PM2.5</dt><dd>{metric(air?.pm25, air?.units.pm25)}</dd></div>
                <div><dt>Ozone</dt><dd>{metric(air?.ozone, air?.units.ozone)}</dd></div>
              </dl>
            </section>
            <section>
              <span><Waves /> Ocean surface</span>
              {marine?.waveHeight !== null && marine?.waveHeight !== undefined ? (
                <dl>
                  <div><dt>Wave</dt><dd>{metric(marine.waveHeight, marine.units.waveHeight)}</dd></div>
                  <div><dt>Period</dt><dd>{metric(marine.wavePeriod, marine.units.wavePeriod)}</dd></div>
                  <div><dt>Swell</dt><dd>{metric(marine.swellWaveHeight, marine.units.waveHeight)}</dd></div>
                  <div><dt>Sea temp</dt><dd>{metric(marine.seaSurfaceTemperature, marine.units.temperature)}</dd></div>
                </dl>
              ) : (
                <p>No marine grid at this coordinate.</p>
              )}
            </section>
          </div>

          <div className="probe-sun">
            {terrain?.elevation !== null && terrain?.elevation !== undefined && (
              <>
                <span><MapPinned /> {metric(terrain.elevation, terrain.unit)}</span>
                <i />
              </>
            )}
            <span><Sunrise /> {clockTime(weather?.sunrise)}</span>
            <i />
            <span><Sunset /> {clockTime(weather?.sunset)}</span>
          </div>

          <div className="probe-sources">
            {data.sources.map((source) => (
              <span key={source.name} title={source.error ?? `${source.latencyMs} ms`}>
                <i className={source.state} /> {source.name.replace("Open-Meteo ", "")}
              </span>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

function SourceCard({ source }: { source: SourceRegistryEntry }) {
  return (
    <article className="source-card">
      <div className="source-card-top">
        <span className="source-domain">
          <i style={{ backgroundColor: domainColors[source.domain] }} />
          {source.domain}
        </span>
        <span className={`integration-chip ${source.integration}`}>
          {source.integration === "connected" && <Check />}
          {(source.integration === "key-needed" || source.integration === "credential-ready") && <Zap />}
          {integrationLabels[source.integration]}
        </span>
      </div>
      <h2>{source.name}</h2>
      <span className="source-provider">{source.provider}</span>
      <p>{source.description}</p>
      {source.requiredEnv?.length ? (
        <span className="source-requirement">
          <Zap /> Set {source.requiredEnv.join(" + ")}
        </span>
      ) : null}
      <dl>
        <div><dt>Protocol</dt><dd>{source.protocol}</dd></div>
        <div><dt>Cadence</dt><dd>{source.cadence}</dd></div>
        <div><dt>Access</dt><dd>{source.auth}</dd></div>
        <div><dt>Coverage</dt><dd>{source.coverage}</dd></div>
      </dl>
      <div className="source-card-footer">
        <span>{source.license}</span>
        <a href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.name} documentation`}>
          <ExternalLink />
        </a>
      </div>
    </article>
  );
}

function sourceName(sourceId: string) {
  return SOURCE_REGISTRY.find((source) => source.id === sourceId)?.name ?? sourceId;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value > 9999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function relativeTime(value: string) {
  const milliseconds = new Date(value).valueOf() - Date.now();
  const minutes = Math.round(milliseconds / 60_000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function metric(value: number | null | undefined, unit: string | null | undefined, fallback = "—") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return fallback;
  return `${Number(value).toLocaleString("en", { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`;
}

function clockTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function coordinateLabel(latitude: number, longitude: number) {
  return `${Math.abs(latitude).toFixed(2)}° ${latitude >= 0 ? "N" : "S"}, ${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? "E" : "W"}`;
}

function weatherCodeLabel(code: number | null) {
  if (code === null) return "Model pending";
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Fog / haze";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

function aqiClass(aqi: number | null | undefined) {
  if (aqi === null || aqi === undefined) return "";
  if (aqi <= 50) return "aqi-good";
  if (aqi <= 100) return "aqi-moderate";
  return "aqi-poor";
}
