"use client";

import dynamic from "next/dynamic";

// Cesium needs the browser, so the globe is never rendered on the server.
export const GlobeView = dynamic(() => import("./Globe"), {
  ssr: false,
  loading: () => (
    <p className="body rok-muted" role="status">
      Loading globe.
    </p>
  ),
});
