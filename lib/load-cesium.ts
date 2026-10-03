// Loads Cesium in the browser from public/cesium, outside the app bundle.
//
// Cesium's own prebuilt Cesium.js is used on purpose. Bundling the npm package
// through the production minifier produced a chunk that is not valid JavaScript
// (octal escapes in a template string, from Cesium's embedded binary data), and it
// would add about 5 MB to the app bundle. The runtime assets and the script are
// copied into public/cesium by scripts/copy-cesium.mjs before `dev` and `build`.
// Types come from the `cesium` package and are erased at build time.

export type CesiumModule = typeof import("cesium");

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
    Cesium?: CesiumModule;
  }
}

const BASE_URL = "/cesium";
let loading: Promise<CesiumModule> | null = null;

/** Loads Cesium once. Call only in the browser. Resolves with `window.Cesium`. */
export function loadCesium(): Promise<CesiumModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Cesium can only be loaded in the browser."));
  }
  if (window.Cesium) return Promise.resolve(window.Cesium);

  loading ??= new Promise<CesiumModule>((resolve, reject) => {
    // Cesium reads this when the script runs, so it is set first.
    window.CESIUM_BASE_URL = BASE_URL;

    if (!document.querySelector("link[data-cesium]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${BASE_URL}/Widgets/widgets.css`;
      link.dataset.cesium = "true";
      document.head.append(link);
    }

    const script = document.createElement("script");
    script.src = `${BASE_URL}/Cesium.js`;
    script.async = true;
    script.onload = () =>
      window.Cesium
        ? resolve(window.Cesium)
        : reject(new Error("Cesium loaded but did not define window.Cesium."));
    script.onerror = () => reject(new Error(`Cesium could not be loaded from ${BASE_URL}/Cesium.js.`));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null; // let a later call try again
    throw error;
  });

  return loading;
}
