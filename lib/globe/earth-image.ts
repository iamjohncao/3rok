// Loads the Natural Earth II picture and reads its pixels, for the surface texture and for the
// land mask the particle globe is cut from. Browser only.

import type { EarthImage } from "./renderer";

export const EARTH_IMAGE_URL = "/earth/natural-earth-ii.jpg";

export async function loadEarthImage(url: string = EARTH_IMAGE_URL): Promise<EarthImage> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser could not read the Earth picture.");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  return { source: image, pixels: data.data, width: data.width, height: data.height };
}
