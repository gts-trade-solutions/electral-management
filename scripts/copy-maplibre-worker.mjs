// MapLibre 6 parses map tiles in a module worker that it loads from a file
// beside its own script. Next.js bundles MapLibre but doesn't emit that file,
// so copy it (and the shared chunk it imports) into public/, where
// components/MapView.tsx points MapLibre at it. Runs before every dev and build,
// so the copy always matches the installed version.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const dist = join(dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist");
const out = join(process.cwd(), "public", "maplibre");

mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, file), join(out, file));
}
console.log("MapLibre worker copied to public/maplibre/");
