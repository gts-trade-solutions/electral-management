/**
 * Shared MapLibre setup for every map in the app. Import this (not
 * "maplibre-gl" directly) before creating a map.
 *
 * MapLibre 6 parses tiles in a module worker that it loads from beside its
 * own script, which doesn't exist once Next.js has bundled it;
 * scripts/copy-maplibre-worker.mjs serves the worker from public/ instead.
 */
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/** OpenFreeMap: free vector tiles, no API key. */
export const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
