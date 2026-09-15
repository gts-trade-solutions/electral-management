"use client";

import type { Feature, FeatureCollection, LineString, Point, Position } from "geojson";
import { LngLatBounds, Map as MapLibreMap, NavigationControl, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { STYLE_URL } from "./maplibre";

export type MiniMapPoint = { lat: number; lng: number; color: string; label?: string; radius?: number };
export type MiniMapLine = { coordinates: Position[]; color: string; dashed?: boolean; width?: number };

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * A small map for detail panels: a few labelled points and lines. It frames
 * everything when it first loads and whenever `frameKey` changes, but not on
 * every data update, so a moving vehicle doesn't keep yanking the view.
 */
export function MiniMap({
  points,
  lines = [],
  frameKey,
  className = "h-56 w-full overflow-hidden rounded-lg ring-1 ring-slate-200",
}: {
  points: MiniMapPoint[];
  lines?: MiniMapLine[];
  frameKey: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const framedKey = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: STYLE_URL,
      center: [28.05, -26.2],
      zoom: 9,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("mini-lines", { type: "geojson", data: EMPTY });
      map.addSource("mini-points", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "mini-lines-solid",
        type: "line",
        source: "mini-lines",
        filter: ["!=", ["get", "dashed"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"] },
      });
      map.addLayer({
        id: "mini-lines-dashed",
        type: "line",
        source: "mini-lines",
        filter: ["==", ["get", "dashed"], true],
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-dasharray": [2, 1.5] },
      });
      map.addLayer({
        id: "mini-points",
        type: "circle",
        source: "mini-points",
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "mini-labels",
        type: "symbol",
        source: "mini-points",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const lineFeatures: Feature<LineString>[] = lines
      .filter((l) => l.coordinates.length >= 2)
      .map((l) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: l.coordinates },
        properties: { color: l.color, dashed: !!l.dashed, width: l.width ?? 3 },
      }));
    const pointFeatures: Feature<Point>[] = points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { color: p.color, label: p.label ?? "", radius: p.radius ?? 6 },
    }));
    void (map.getSource("mini-lines") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: lineFeatures });
    void (map.getSource("mini-points") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: pointFeatures });

    if (framedKey.current === frameKey) return;
    framedKey.current = frameKey;
    const bounds = new LngLatBounds();
    let any = false;
    for (const p of points) {
      bounds.extend([p.lng, p.lat]);
      any = true;
    }
    for (const l of lines) {
      for (const c of l.coordinates) {
        bounds.extend([c[0], c[1]]);
        any = true;
      }
    }
    if (any) map.fitBounds(bounds, { padding: 36, maxZoom: 14, duration: 0 });
  }, [points, lines, frameKey, ready]);

  return <div ref={container} className={className} />;
}
