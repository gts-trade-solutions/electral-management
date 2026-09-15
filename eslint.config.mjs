import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // public/maplibre/ holds MapLibre's minified worker, copied from node_modules.
  { ignores: ["node_modules/**", ".next/**", "out/**", "public/maplibre/**", "next-env.d.ts"] },
];

export default eslintConfig;
