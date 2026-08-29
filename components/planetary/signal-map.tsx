"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { Crosshair, LocateFixed, Minus, Plus } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CATEGORY_META, type PlanetarySignal, type SignalCategory } from "@/lib/planetary/types";

const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

const categoryExpression: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "category"],
  "seismic",
  CATEGORY_META.seismic.color,
  "climate",
  CATEGORY_META.climate.color,
  "biosphere",
  CATEGORY_META.biosphere.color,
  "ocean",
  CATEGORY_META.ocean.color,
  "humanitarian",
  CATEGORY_META.humanitarian.color,
  "space",
  CATEGORY_META.space.color,
  "knowledge",
  CATEGORY_META.knowledge.color,
  "infrastructure",
  CATEGORY_META.infrastructure.color,
  "#f4f4f0",
];

interface SignalMapProps {
  signals: PlanetarySignal[];
  selectedId: string | null;
  onSelect: (signal: PlanetarySignal | null) => void;
  probePoint?: { latitude: number; longitude: number } | null;
  onInspect?: (point: { latitude: number; longitude: number }) => void;
}

export function SignalMap({ signals, selectedId, onSelect, probePoint, onInspect }: SignalMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const probeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const signalsRef = useRef<PlanetarySignal[]>([]);
  const selectRef = useRef(onSelect);
  const inspectRef = useRef(onInspect);
  const [loaded, setLoaded] = useState(false);

  const mappedSignals = useMemo(
    () =>
      signals.filter(
        (signal) =>
          typeof signal.latitude === "number" &&
          typeof signal.longitude === "number" &&
          Math.abs(signal.latitude) <= 90 &&
          Math.abs(signal.longitude) <= 180,
      ),
    [signals],
  );

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: mappedSignals.map((signal) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [signal.longitude as number, signal.latitude as number],
        },
        properties: {
          id: signal.id,
          category: signal.category,
          severity: signal.severity,
          selected: signal.id === selectedId ? 1 : 0,
          sample: signal.sample ? 1 : 0,
        },
      })),
    }),
    [mappedSignals, selectedId],
  );

  useEffect(() => {
    signalsRef.current = mappedSignals;
    selectRef.current = onSelect;
    inspectRef.current = onInspect;
  }, [mappedSignals, onInspect, onSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [22, 18],
      zoom: 1.25,
      minZoom: 0.6,
      maxZoom: 12,
      attributionControl: false,
      cooperativeGestures: true,
      renderWorldCopies: true,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: "Open data providers" }),
      "bottom-right",
    );

    map.on("load", () => {
      map.addSource("planetary-signals", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 6,
        clusterRadius: 42,
      });

      map.addLayer({
        id: "signal-cluster-halo",
        type: "circle",
        source: "planetary-signals",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(224,255,238,.08)",
          "circle-radius": ["step", ["get", "point_count"], 22, 20, 29, 70, 36],
          "circle-stroke-color": "rgba(224,255,238,.18)",
          "circle-stroke-width": 1,
        },
      });

      map.addLayer({
        id: "signal-cluster",
        type: "circle",
        source: "planetary-signals",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(8,15,16,.94)",
          "circle-radius": ["step", ["get", "point_count"], 14, 20, 18, 70, 23],
          "circle-stroke-color": "#a9f6c7",
          "circle-stroke-opacity": 0.65,
          "circle-stroke-width": 1,
        },
      });

      map.addLayer({
        id: "signal-count",
        type: "symbol",
        source: "planetary-signals",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 10,
          "text-font": ["Open Sans Bold"],
        },
        paint: { "text-color": "#dff7e8" },
      });

      map.addLayer({
        id: "signal-point-halo",
        type: "circle",
        source: "planetary-signals",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": categoryExpression,
          "circle-radius": ["+", ["*", ["get", "severity"], 2], 7],
          "circle-opacity": 0.12,
          "circle-blur": 0.35,
        },
      });

      map.addLayer({
        id: "signal-point",
        type: "circle",
        source: "planetary-signals",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": categoryExpression,
          "circle-radius": [
            "case",
            ["==", ["get", "selected"], 1],
            8,
            ["+", 2.8, ["*", ["get", "severity"], 0.7]],
          ],
          "circle-opacity": ["case", ["==", ["get", "sample"], 1], 0.52, 0.95],
          "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#ffffff", "#081011"],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 2, 1],
        },
      });

      setLoaded(true);
    });

    map.on("click", "signal-cluster", async (event) => {
      const feature = event.features?.[0];
      const clusterId = Number(feature?.properties?.cluster_id);
      const coordinates = pointFromFeature(feature?.geometry);
      const source = map.getSource("planetary-signals") as GeoJSONSource;
      if (!coordinates || !Number.isFinite(clusterId)) return;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({ center: coordinates, zoom, duration: 650 });
    });

    map.on("click", "signal-point", (event) => {
      const id = String(event.features?.[0]?.properties?.id ?? "");
      selectRef.current(signalsRef.current.find((signal) => signal.id === id) ?? null);
    });

    map.on("click", (event) => {
      const hit = map.queryRenderedFeatures(event.point, {
        layers: ["signal-point", "signal-cluster"],
      });
      if (!hit.length) {
        selectRef.current(null);
        inspectRef.current?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      }
    });

    for (const layerId of ["signal-point", "signal-cluster"]) {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const source = mapRef.current?.getSource("planetary-signals") as GeoJSONSource | undefined;
    source?.setData(geojson);
  }, [geojson, loaded]);

  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const signal = mappedSignals.find((item) => item.id === selectedId);
    if (signal?.longitude === undefined || signal.latitude === undefined) return;
    mapRef.current.flyTo({
      center: [signal.longitude, signal.latitude],
      zoom: Math.max(mapRef.current.getZoom(), 4.2),
      speed: 1.1,
      curve: 1.4,
    });
  }, [selectedId, mappedSignals]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    probeMarkerRef.current?.remove();
    probeMarkerRef.current = null;
    if (!probePoint) return;
    const marker = document.createElement("span");
    marker.className = "probe-marker";
    marker.setAttribute("aria-hidden", "true");
    probeMarkerRef.current = new maplibregl.Marker({ element: marker })
      .setLngLat([probePoint.longitude, probePoint.latitude])
      .addTo(map);
    return () => {
      probeMarkerRef.current?.remove();
      probeMarkerRef.current = null;
    };
  }, [probePoint]);

  const zoomBy = (amount: number) => mapRef.current?.zoomTo((mapRef.current?.getZoom() ?? 1) + amount, { duration: 280 });
  const reset = () => mapRef.current?.flyTo({ center: [22, 18], zoom: 1.25, duration: 700 });
  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 6.5, duration: 900 }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 4_000 },
    );
  };

  return (
    <div className="signal-map-shell">
      <div ref={containerRef} className="signal-map" aria-label="Interactive map of planetary signals" />
      {!loaded && (
        <div className="map-loading" aria-live="polite">
          <span className="map-loading-orbit" />
          Calibrating field
        </div>
      )}

      <div className="map-crosshair" aria-hidden="true">
        <span />
      </div>

      <div className="probe-hint">
        <LocateFixed /> Click anywhere to inspect local weather + air
      </div>

      <div className="map-tools">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => zoomBy(1)} aria-label="Zoom in">
              <Plus />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom in</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => zoomBy(-1)} aria-label="Zoom out">
              <Minus />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={reset} aria-label="Reset global view">
              <Crosshair />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Global view</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={locate} aria-label="Go to my location">
              <LocateFixed />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Locate me</TooltipContent>
        </Tooltip>
      </div>

      <div className="map-legend" aria-label="Map legend">
        {(Object.entries(CATEGORY_META) as Array<[SignalCategory, (typeof CATEGORY_META)[SignalCategory]]>)
          .slice(0, 6)
          .map(([key, meta]) => (
            <span key={key}>
              <i style={{ background: meta.color }} />
              {meta.label}
            </span>
          ))}
      </div>
    </div>
  );
}

function pointFromFeature(geometry: unknown): [number, number] | undefined {
  const candidate = geometry as { type?: string; coordinates?: unknown } | undefined;
  if (candidate?.type !== "Point" || !Array.isArray(candidate.coordinates)) return undefined;
  const [longitude, latitude] = candidate.coordinates;
  return typeof longitude === "number" && typeof latitude === "number"
    ? [longitude, latitude]
    : undefined;
}
