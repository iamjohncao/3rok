// Copies Cesium's prebuilt Cesium.js and the runtime assets it loads (Workers, Assets,
// Widgets, ThirdParty) into public/cesium, where window.CESIUM_BASE_URL points. Runs before
// `next dev` and `next build`. No bundler plugin: just a copy, skipped when the
// installed Cesium version is already there.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "node_modules", "cesium", "Build", "Cesium");
const target = join(root, "public", "cesium");
const stamp = join(target, ".version");

if (!existsSync(source)) {
  console.error("copy-cesium: node_modules/cesium is missing. Run `npm install` first.");
  process.exit(1);
}

const cesiumVersion = JSON.parse(readFileSync(join(root, "node_modules", "cesium", "package.json"), "utf8")).version;
// The stamp names the layout as well as the version, so changing what is copied re-copies.
const version = `${cesiumVersion}+script`;

if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) {
  console.log(`copy-cesium: Cesium ${version} assets are already in public/cesium`);
} else {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const directory of ["Workers", "Assets", "Widgets", "ThirdParty"]) {
    cpSync(join(source, directory), join(target, directory), { recursive: true });
  }
  // Cesium's own prebuilt script, loaded with a script tag. See lib/load-cesium.ts for why.
  cpSync(join(source, "Cesium.js"), join(target, "Cesium.js"));
  writeFileSync(stamp, version);
  console.log(`copy-cesium: copied Cesium ${version} assets into public/cesium`);
}
