"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { Crosshair, LocateFixed, Minus, Plus } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CATEGORY_META, type PlanetarySignal, type SignalCategory } from "@/lib/planetary/types";

// OpenFreeMap's public styles are keyless. If the external style cannot load, the
// local fallback still renders the live signal layer instead of blocking the map.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

const FALLBACK_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "fallback-background",
      type: "background",
      paint: { "background-color": "#080d0e" },
    },
  ],
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
  const [usingFallback, setUsingFallback] = useState(false);
  const [rendererUnavailable, setRendererUnavailable] = useState(false);

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

    const activateRendererFallback = () => {
      const timer = window.setTimeout(() => {
        setRendererUnavailable(true);
        setLoaded(true);
      }, 0);
      return () => window.clearTimeout(timer);
    };

    const rendererProbe = document.createElement("canvas");
    if (!rendererProbe.getContext("webgl2")) {
      return activateRendererFallback();
    }

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
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
    } catch {
      containerRef.current.replaceChildren();
      return activateRendererFallback();
    }

    map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: "Open data providers" }),
      "bottom-right",
    );

    let fallbackApplied = false;

    const addSignalLayers = () => {
      if (!map.getSource("planetary-signals")) {
        map.addSource("planetary-signals", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterMaxZoom: 6,
          clusterRadius: 42,
        });
      }

      if (!map.getLayer("signal-cluster-halo")) map.addLayer({
        id: "signal-cluster-halo",
        type: "circle",
        source: "planetary-signals",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(169,246,199,.16)",
          "circle-radius": ["step", ["get", "point_count"], 22, 20, 29, 70, 36],
          "circle-stroke-color": "rgba(224,255,238,.34)",
          "circle-stroke-width": 1.25,
        },
      });

      if (!map.getLayer("signal-cluster")) map.addLayer({
        id: "signal-cluster",
        type: "circle",
        source: "planetary-signals",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(8,15,16,.94)",
          "circle-radius": ["step", ["get", "point_count"], 14, 20, 18, 70, 23],
          "circle-stroke-color": "#a9f6c7",
          "circle-stroke-opacity": 0.9,
          "circle-stroke-width": 1.5,
        },
      });

      if (!map.getLayer("signal-point-halo")) map.addLayer({
        id: "signal-point-halo",
        type: "circle",
        source: "planetary-signals",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": categoryExpression,
          "circle-radius": ["+", ["*", ["get", "severity"], 2], 7],
          "circle-opacity": 0.22,
          "circle-blur": 0.35,
        },
      });

      if (!map.getLayer("signal-point")) map.addLayer({
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
          "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#ffffff", "#061010"],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 2, 1.25],
        },
      });

      // The plain fallback deliberately avoids a glyph dependency. Locations and
      // clusters remain interactive even if every external map asset is blocked.
      if (!fallbackApplied && !map.getLayer("signal-count")) {
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
      }

      setLoaded(true);
    };

    map.on("style.load", addSignalLayers);

    const fallbackTimer = window.setTimeout(() => {
      if (map.isStyleLoaded() || fallbackApplied) return;
      fallbackApplied = true;
      setUsingFallback(true);
      map.setStyle(FALLBACK_MAP_STYLE);
      window.setTimeout(() => {
        if (mapRef.current === map && map.isStyleLoaded()) addSignalLayers();
      }, 0);
    }, 8_000);

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
      window.clearTimeout(fallbackTimer);
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
    <div className="signal-map-shell" data-mapped-count={mappedSignals.length}>
      <div ref={containerRef} className="signal-map" aria-label="Interactive map of planetary signals" />
      {rendererUnavailable && (
        <div
          className="coordinate-fallback"
          role="img"
          aria-label={`${mappedSignals.length} planetary signal locations on a coordinate field`}
        >
          {mappedSignals.map((signal) => {
            const longitude = signal.longitude as number;
            const latitude = signal.latitude as number;
            const color = CATEGORY_META[signal.category].color;
            const size = 5 + signal.severity * 1.6;
            return (
              <button
                key={signal.id}
                type="button"
                className={`coordinate-fallback-point${signal.id === selectedId ? " selected" : ""}`}
                style={{
                  background: color,
                  boxShadow: `0 0 ${8 + signal.severity * 2}px ${color}`,
                  height: size,
                  left: `${((longitude + 180) / 360) * 100}%`,
                  opacity: signal.sample ? 0.62 : 0.95,
                  top: `${((90 - latitude) / 180) * 100}%`,
                  width: size,
                }}
                aria-label={`${CATEGORY_META[signal.category].label}: ${signal.title}`}
                onClick={() => onSelect(signal)}
              />
            );
          })}
        </div>
      )}
      {!loaded && (
        <div className="map-loading" aria-live="polite">
          <span className="map-loading-orbit" />
          Calibrating field
        </div>
      )}

      {(usingFallback || rendererUnavailable) && (
        <div className="map-fallback-note" role="status">
          {rendererUnavailable
            ? "GPU map unavailable — live coordinates are shown on the field"
            : "Basemap unavailable — live signal locations are still shown"}
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
