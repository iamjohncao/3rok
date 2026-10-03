"use client";

// The globe. Client-only (loaded with ssr: false). It draws the OEM's own states:
// each segment as a line, plus a marker that follows the scrubbed time. The file is
// GCRF. The Earth-fixed positions here are a view, not a second file.

import { useEffect, useRef, useState } from "react";
import { gcrfToEarthFixed } from "../lib/frame";
import { loadCesium, type CesiumModule } from "../lib/load-cesium";
import type { Oem, Vec3 } from "../lib/oem";
import { sampleOem, samplePath } from "../lib/oem-sample";

const METERS_PER_KM = 1000;
const LINE_STEP_SECONDS = 5;

function themeColor(Cesium: CesiumModule, name: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return Cesium.Color.fromCssColorString(value);
}

function toCartesian(Cesium: CesiumModule, gcrfKm: Vec3, time: number) {
  const fixed = gcrfToEarthFixed(gcrfKm, time);
  return new Cesium.Cartesian3(fixed[0] * METERS_PER_KM, fixed[1] * METERS_PER_KM, fixed[2] * METERS_PER_KM);
}

type Scene = {
  Cesium: CesiumModule;
  viewer: import("cesium").Viewer;
  marker: import("cesium").Entity;
};

function placeMarker(scene: Scene, oem: Oem, time: number) {
  const sample = sampleOem(oem, time);
  if (sample === null) {
    scene.marker.show = false;
  } else {
    scene.marker.show = true;
    scene.marker.position = new scene.Cesium.ConstantPositionProperty(
      toCartesian(scene.Cesium, sample.position, time),
    );
  }
  scene.viewer.scene.requestRender();
}

export default function Globe({ oem, time }: { oem: Oem; time: number }) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const latestTime = useRef(time);
  const [failure, setFailure] = useState<string | null>(null);
  latestTime.current = time;

  // Build the viewer and the line whenever the file changes.
  useEffect(() => {
    let cancelled = false;
    let viewer: import("cesium").Viewer | undefined;
    let observer: ResizeObserver | undefined;

    (async () => {
      try {
        const Cesium = await loadCesium();
        if (cancelled || !container.current) return;

        // With an ion token the imagery is Cesium's world imagery. Without one, an
        // ellipsoid with the static Natural Earth layer that ships with Cesium, so the
        // path still draws.
        const token = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        let baseLayer;
        if (token) {
          Cesium.Ion.defaultAccessToken = token;
          baseLayer = Cesium.ImageryLayer.fromWorldImagery({});
        } else {
          baseLayer = new Cesium.ImageryLayer(
            await Cesium.TileMapServiceImageryProvider.fromUrl(
              Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
            ),
          );
        }
        if (cancelled || !container.current) return;

        viewer = new Cesium.Viewer(container.current, {
          baseLayer,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          scene3DOnly: true,
          requestRenderMode: true,
          maximumRenderTimeChange: Number.POSITIVE_INFINITY,
        });
        viewer.scene.globe.enableLighting = false;

        const lineColor = themeColor(Cesium, "--accent");
        const allPoints: import("cesium").Cartesian3[] = [];
        for (const segment of samplePath(oem, LINE_STEP_SECONDS)) {
          const positions = segment.map((sample) => toCartesian(Cesium, sample.position, sample.time));
          allPoints.push(...positions);
          viewer.entities.add({
            polyline: { positions, width: 3, material: lineColor, arcType: Cesium.ArcType.NONE },
          });
        }

        const marker = viewer.entities.add({
          point: {
            pixelSize: 11,
            color: themeColor(Cesium, "--ink"),
            outlineColor: themeColor(Cesium, "--surface-100"),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });

        // Look straight down at the Earth from above the middle of the path, far enough
        // back that the whole Earth fits in a wide frame and the whole path is in view.
        const center = Cesium.BoundingSphere.fromPoints(allPoints).center;
        const farthest = Math.max(...allPoints.map((point) => Cesium.Cartesian3.magnitude(point)));
        const distance = Math.max(26_000_000, farthest * 2.6);
        viewer.camera.setView({
          destination: Cesium.Cartesian3.multiplyByScalar(
            Cesium.Cartesian3.normalize(center, new Cesium.Cartesian3()),
            distance,
            new Cesium.Cartesian3(),
          ),
          orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
        });

        scene.current = { Cesium, viewer, marker };
        placeMarker(scene.current, oem, latestTime.current);
        container.current.dataset.ready = "true";

        observer = new ResizeObserver(() => viewer?.resize());
        observer.observe(container.current);
      } catch (error) {
        if (!cancelled) {
          setFailure(
            error instanceof Error && /webgl/i.test(error.message)
              ? "This browser cannot draw the globe because WebGL is unavailable. The readings beside it still follow the file."
              : "The globe could not start. The readings beside it still follow the file.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      scene.current = null;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, [oem]);

  // Move the marker when the scrubbed time changes.
  useEffect(() => {
    if (scene.current) placeMarker(scene.current, oem, time);
  }, [oem, time]);

  return (
    <div className="globe">
      <div ref={container} className="globe__canvas" />
      {failure ? (
        <p className="globe__failure body" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
