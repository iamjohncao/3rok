// The WebGL2 renderer for both globes. One scene, two looks:
//
//   realistic  the Earth as a textured surface, lit from one side, with a rim of atmosphere
//   particles  the Earth as 40,000 dots, each with its own fold schedule
//
// and two shapes, a globe and a plate carree map, that the scene folds between. The satellite's
// path, the graticule and the marker are drawn the same way in both looks. The heat layer is a
// texture on the realistic surface and a colour on each particle.
//
// Nothing here reads the case, the OEM, or the network. It is handed a path, a satellite, a
// texture and a heat field, and it draws them.

import { cameraFrame, satelliteWorldPoint, type CameraState, type SatelliteView } from "./camera";
import { heatTexture, particleColors, type HeatField, type Ramp, type Rgb } from "./heat";
import { toNdc } from "./mat4";
import { fibonacciParticles, landMask, type Particles } from "./particles";
import { INSTANCE_FLOATS, graticuleInstances } from "./path-geometry";
import { smoothstep } from "./projection";
import {
  LINE_FRAG,
  LINE_VERT,
  MARKER_FRAG,
  MARKER_VERT,
  PARTICLE_FRAG,
  PARTICLE_VERT,
  SURFACE_FRAG,
  SURFACE_VERT,
} from "./shaders";

export type GlobeStyle = "realistic" | "particles";
export type GlobeShape = "globe" | "map";
export type GlobeFollow = "wide" | "chase";

export class GlobeUnsupportedError extends Error {
  constructor() {
    super("This browser cannot draw the globe. It needs WebGL 2.");
    this.name = "GlobeUnsupportedError";
  }
}

/** The design tokens the scene is painted with, read from the page by the component. 0 to 255 per channel. */
export type GlobeTokens = {
  background: Rgb;
  landDot: Rgb;
  oceanDot: Rgb;
  ink: Rgb;
  inkSubtle: Rgb;
  lineStrong: Rgb;
  accent: Rgb;
  ramp: Ramp;
};

export type EarthImage = { source: TexImageSource; pixels: Uint8ClampedArray; width: number; height: number };

const FOLD_MS = 1900;
const CHASE_MS = 1000;
const MESH_LON = 180;
const MESH_LAT = 90;

const norm = (c: Rgb): [number, number, number] => [c[0] / 255, c[1] / 255, c[2] / 255];

type Anim = { from: number; to: number; start: number; duration: number };

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function program(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program failed to link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;
function uniforms(gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]): Uniforms {
  return Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
}

type Lines = { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number };

export class GlobeRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly surfaceProgram: WebGLProgram;
  private readonly particleProgram: WebGLProgram;
  private readonly lineProgram: WebGLProgram;
  private readonly markerProgram: WebGLProgram;
  private readonly su: Uniforms;
  private readonly pu: Uniforms;
  private readonly lu: Uniforms;
  private readonly mu: Uniforms;

  private readonly surfaceVao: WebGLVertexArrayObject;
  private readonly surfaceIndexCount: number;
  private readonly particleVao: WebGLVertexArrayObject;
  private readonly particleHeatBuffer: WebGLBuffer;
  private readonly particleLandBuffer: WebGLBuffer;
  private readonly markerVao: WebGLVertexArrayObject;
  private readonly cornerBuffer: WebGLBuffer;
  private readonly graticule: Lines;
  private readonly path: Lines;
  private readonly stem: Lines;
  private readonly earthTexture: WebGLTexture;
  private readonly heatTex: WebGLTexture;
  private readonly particles: Particles;
  private landMaskValues: Uint8Array;
  private earthPixels: { pixels: Uint8ClampedArray; width: number; height: number } | null = null;
  private heatField: HeatField | null = null;

  private style: GlobeStyle = "realistic";
  private shape: GlobeShape = "globe";
  private follow: GlobeFollow = "wide";
  private flat = 0;
  private chase = 0;
  private centerLon = 0;
  private centerLat = 0.25;
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private chaseZoom = 1;
  private satellite: SatelliteView | null = null;
  private now = 0;
  private flatAnim: Anim | null = null;
  private chaseAnim: Anim | null = null;
  private raf = 0;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private tokens: GlobeTokens,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new GlobeUnsupportedError();
    this.gl = gl;

    this.surfaceProgram = program(gl, SURFACE_VERT, SURFACE_FRAG);
    this.particleProgram = program(gl, PARTICLE_VERT, PARTICLE_FRAG);
    this.lineProgram = program(gl, LINE_VERT, LINE_FRAG);
    this.markerProgram = program(gl, MARKER_VERT, MARKER_FRAG);
    this.su = uniforms(gl, this.surfaceProgram, ["u_viewProj", "u_fold", "u_earth", "u_heat", "u_heatOn", "u_eye", "u_rim"]);
    this.pu = uniforms(gl, this.particleProgram, ["u_viewProj", "u_flat", "u_eye", "u_pointPx", "u_sizeRef", "u_landColor", "u_oceanColor"]);
    this.lu = uniforms(gl, this.lineProgram, ["u_viewProj", "u_fold", "u_viewport", "u_widthPx", "u_lift", "u_eye", "u_pastColor", "u_futureColor", "u_now", "u_useTime", "u_fadeBack"]);
    this.mu = uniforms(gl, this.markerProgram, ["u_viewProj", "u_fold", "u_sat", "u_sizePx", "u_eye", "u_ink", "u_accent", "u_fadeBack"]);

    // The surface: a grid of longitude and latitude, drawn as triangles.
    const cols = MESH_LON + 1;
    const rows = MESH_LAT + 1;
    const lonlat = new Float32Array(cols * rows * 2);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        lonlat[(j * cols + i) * 2] = -Math.PI + (i / MESH_LON) * 2 * Math.PI;
        lonlat[(j * cols + i) * 2 + 1] = -Math.PI / 2 + (j / MESH_LAT) * Math.PI;
      }
    }
    const indices = new Uint16Array(MESH_LON * MESH_LAT * 6);
    let k = 0;
    for (let j = 0; j < MESH_LAT; j++) {
      for (let i = 0; i < MESH_LON; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.set([a, b, c, b, d, c], k);
        k += 6;
      }
    }
    this.surfaceIndexCount = indices.length;
    this.surfaceVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.surfaceVao);
    this.bufferAttribute(this.surfaceProgram, "a_lonlat", lonlat, 2);
    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    // The particles.
    this.particles = fibonacciParticles();
    this.landMaskValues = new Uint8Array(this.particles.count).fill(1);
    this.particleVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.particleVao);
    const pl = new Float32Array(this.particles.count * 2);
    for (let i = 0; i < this.particles.count; i++) {
      pl[i * 2] = this.particles.lon[i];
      pl[i * 2 + 1] = this.particles.lat[i];
    }
    this.bufferAttribute(this.particleProgram, "a_lonlat", pl, 2);
    this.bufferAttribute(this.particleProgram, "a_delay", this.particles.delay, 1);
    this.particleLandBuffer = this.bufferAttribute(this.particleProgram, "a_land", new Float32Array(this.particles.count).fill(1), 1, gl.DYNAMIC_DRAW);
    this.particleHeatBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleHeatBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(this.particles.count * 4), gl.DYNAMIC_DRAW);
    const heatLoc = gl.getAttribLocation(this.particleProgram, "a_heat");
    gl.enableVertexAttribArray(heatLoc);
    gl.vertexAttribPointer(heatLoc, 4, gl.UNSIGNED_BYTE, true, 0, 0);

    // Lines: four corners shared by every instance, and one buffer of instances per set.
    this.cornerBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.graticule = this.makeLines(graticuleInstances());
    this.path = this.makeLines(new Float32Array(0));
    this.stem = this.makeLines(new Float32Array(INSTANCE_FLOATS));
    this.stem.count = 1;

    this.markerVao = gl.createVertexArray()!;

    // Textures.
    this.earthTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.earthTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(tokensPixel(tokens.background)));
    this.heatTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.heatTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

    gl.bindVertexArray(null);
    this.resize();
  }

  // ---- building blocks

  private bufferAttribute(p: WebGLProgram, name: string, data: Float32Array, size: number, usage: number = this.gl.STATIC_DRAW): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const loc = gl.getAttribLocation(p, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  private makeLines(instances: Float32Array): Lines {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    const corner = gl.getAttribLocation(this.lineProgram, "a_corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(corner, 0);

    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);
    const stride = INSTANCE_FLOATS * 4;
    for (const [name, size, offset] of [["a_p0", 3, 0], ["a_p1", 3, 12], ["a_time", 2, 24]] as const) {
      const loc = gl.getAttribLocation(this.lineProgram, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return { vao, buffer, count: instances.length / INSTANCE_FLOATS };
  }

  // ---- what the scene is told

  setTokens(tokens: GlobeTokens): void {
    this.tokens = tokens;
    if (this.heatField) this.setHeat(this.heatField);
    this.invalidate();
  }

  /** The Earth's picture, and from it which particles are land. */
  setEarth(earth: EarthImage): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.earthTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, earth.source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);

    this.earthPixels = { pixels: earth.pixels, width: earth.width, height: earth.height };
    this.landMaskValues = landMask(earth.pixels, earth.width, earth.height, this.particles.lon, this.particles.lat);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleLandBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(this.landMaskValues), gl.DYNAMIC_DRAW);
    this.invalidate();
  }

  /** The heat layer, or null to draw none. */
  setHeat(field: HeatField | null): void {
    const gl = this.gl;
    this.heatField = field;
    gl.bindTexture(gl.TEXTURE_2D, this.heatTex);
    if (field) {
      const pixels = heatTexture(field, this.tokens.ramp);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 360, 180, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const colors = field
      ? particleColors(field, this.particles.lon, this.particles.lat, this.tokens.ramp)
      : new Uint8Array(this.particles.count * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleHeatBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    this.invalidate();
  }

  /** The path as instances from lib/globe/path-geometry.ts. */
  setPath(instances: Float32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.path.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);
    this.path.count = instances.length / INSTANCE_FLOATS;
    this.invalidate();
  }

  setSatellite(sat: SatelliteView | null): void {
    this.satellite = sat;
    if (sat) {
      const gl = this.gl;
      const R = 6378.137;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stem.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([sat.lon, sat.lat, sat.altKm / R, sat.lon, sat.lat, 0, 0, 0]));
    }
    this.invalidate();
  }

  /** Seconds from the start of the file. The part of the path up to here is drawn bright. */
  setNow(seconds: number): void {
    this.now = seconds;
    this.invalidate();
  }

  setStyle(style: GlobeStyle): void {
    this.style = style;
    this.invalidate();
  }

  setShape(shape: GlobeShape): void {
    if (shape === this.shape) return;
    this.shape = shape;
    this.flatAnim = { from: this.flat, to: shape === "map" ? 1 : 0, start: performance.now(), duration: FOLD_MS * Math.abs((shape === "map" ? 1 : 0) - this.flat) };
    this.invalidate();
  }

  setFollow(follow: GlobeFollow): void {
    if (follow === this.follow) return;
    this.follow = follow;
    const to = follow === "chase" ? 1 : 0;
    this.chaseAnim = { from: this.chase, to, start: performance.now(), duration: CHASE_MS * Math.abs(to - this.chase) };
    this.invalidate();
  }

  /** Where the wide view of the globe looks, radians. */
  lookAt(lon: number, lat: number): void {
    this.centerLon = lon;
    this.centerLat = Math.max(-1.4, Math.min(1.4, lat));
    this.invalidate();
  }

  /** A drag of dx, dy CSS pixels. Turns the globe, or slides the map. Chase view ignores it: the satellite stays centred. */
  drag(dx: number, dy: number): void {
    if (this.follow === "chase") return;
    if (this.shape === "globe" && this.flat < 0.5) {
      const k = 0.005 / this.zoom;
      this.centerLon -= dx * k;
      this.centerLat = Math.max(-1.4, Math.min(1.4, this.centerLat + dy * k));
    } else {
      const width = this.canvas.clientWidth || 1;
      const k = (2 * Math.PI * 1.05) / (width * this.zoom);
      this.panX = Math.max(-Math.PI, Math.min(Math.PI, this.panX - dx * k));
      this.panY = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.panY + dy * k));
    }
    this.invalidate();
  }

  zoomBy(factor: number): void {
    if (this.follow === "chase") this.chaseZoom = Math.max(0.4, Math.min(4, this.chaseZoom * factor));
    else this.zoom = Math.max(0.6, Math.min(6, this.zoom * factor));
    this.invalidate();
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.invalidate();
  }

  /** What is on screen now, for tests and for the page's own labels. */
  state(): { flat: number; chase: number; style: GlobeStyle; markerNdc: [number, number] | null } {
    const sat = this.satellite;
    const frame = cameraFrame(this.cameraState());
    const m = sat ? toNdc(frame.viewProj, satelliteWorldPoint(sat, this.flat)) : null;
    return { flat: this.flat, chase: this.chase, style: this.style, markerNdc: m ? [m.x, m.y] : null };
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  // ---- drawing

  private cameraState(): CameraState {
    return {
      flat: this.flat,
      chase: this.chase,
      aspect: this.canvas.width / Math.max(1, this.canvas.height),
      centerLon: this.centerLon,
      centerLat: this.centerLat,
      panX: this.panX,
      panY: this.panY,
      zoom: this.zoom,
      chaseZoom: this.chaseZoom,
      satellite: this.satellite,
    };
  }

  invalidate(): void {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    let animating = false;
    const step = (anim: Anim | null): [number | null, Anim | null] => {
      if (!anim) return [null, null];
      const t = anim.duration <= 0 ? 1 : (now - anim.start) / anim.duration;
      if (t >= 1) return [anim.to, null];
      animating = true;
      return [anim.from + (anim.to - anim.from) * Math.max(0, t), anim];
    };
    const [flat, flatAnim] = step(this.flatAnim);
    const [chase, chaseAnim] = step(this.chaseAnim);
    if (flat !== null) this.flat = flat;
    if (chase !== null) this.chase = chase;
    this.flatAnim = flatAnim;
    this.chaseAnim = chaseAnim;

    this.draw();
    if (animating) this.raf = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const gl = this.gl;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const t = this.tokens;
    const frame = cameraFrame(this.cameraState());
    const fold = smoothstep(this.flat);
    const realistic = this.style === "realistic";
    const eye = frame.eye;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const [br, bg, bb] = norm(t.background);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 1. The Earth.
    if (realistic) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.useProgram(this.surfaceProgram);
      gl.uniformMatrix4fv(this.su.u_viewProj, false, frame.viewProj);
      gl.uniform1f(this.su.u_fold, fold);
      gl.uniform3f(this.su.u_eye, eye[0], eye[1], eye[2]);
      gl.uniform3f(this.su.u_rim, ...norm(t.accent));
      gl.uniform1f(this.su.u_heatOn, this.heatField ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.earthTexture);
      gl.uniform1i(this.su.u_earth, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.heatTex);
      gl.uniform1i(this.su.u_heat, 1);
      gl.bindVertexArray(this.surfaceVao);
      gl.drawElements(gl.TRIANGLES, this.surfaceIndexCount, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.particleProgram);
      gl.uniformMatrix4fv(this.pu.u_viewProj, false, frame.viewProj);
      gl.uniform1f(this.pu.u_flat, this.flat);
      gl.uniform3f(this.pu.u_eye, eye[0], eye[1], eye[2]);
      gl.uniform1f(this.pu.u_pointPx, 2.4 * dpr);
      const wide = cameraFrame({ ...this.cameraState(), chase: 0 });
      const wideDistance = Math.hypot(wide.eye[0] - wide.target[0], wide.eye[1] - wide.target[1], wide.eye[2] - wide.target[2]);
      gl.uniform1f(this.pu.u_sizeRef, wideDistance * (0.75 + 0.25 * fold));
      gl.uniform3f(this.pu.u_landColor, ...norm(t.landDot));
      gl.uniform3f(this.pu.u_oceanColor, ...norm(t.oceanDot));
      gl.bindVertexArray(this.particleVao);
      gl.drawArrays(gl.POINTS, 0, this.particles.count);
    }

    // 2. Lines and the marker go on top. On the realistic globe the Earth hides what is behind it.
    // On the particle globe nothing is solid, so what is behind fades instead.
    if (realistic) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
    } else {
      gl.disable(gl.DEPTH_TEST);
    }
    const fadeBack = realistic ? 0 : 1;
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(this.lu.u_viewProj, false, frame.viewProj);
    gl.uniform1f(this.lu.u_fold, fold);
    gl.uniform2f(this.lu.u_viewport, this.canvas.width, this.canvas.height);
    gl.uniform3f(this.lu.u_eye, eye[0], eye[1], eye[2]);
    gl.uniform1f(this.lu.u_fadeBack, fadeBack);
    gl.uniform1f(this.lu.u_now, this.now);

    const drawLines = (lines: Lines, widthPx: number, lift: number, past: [number, number, number, number], future: [number, number, number, number] | null) => {
      if (lines.count === 0) return;
      gl.uniform1f(this.lu.u_widthPx, widthPx * dpr);
      gl.uniform1f(this.lu.u_lift, lift);
      gl.uniform4f(this.lu.u_pastColor, ...past);
      gl.uniform4f(this.lu.u_futureColor, ...(future ?? past));
      gl.uniform1f(this.lu.u_useTime, future ? 1 : 0);
      gl.bindVertexArray(lines.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lines.count);
    };
    const [lr, lg, lb] = norm(t.lineStrong);
    const [ar, ag, ab] = norm(t.accent);
    const [ir, ig, ib] = norm(t.inkSubtle);
    const [wr, wg, wb] = norm(t.ink);
    drawLines(this.graticule, 1, 0.01, [lr, lg, lb, realistic ? 0.3 : 0.22], null);
    drawLines(this.path, 2.5, 0.02, [ar, ag, ab, 1], [ir, ig, ib, 0.85]);
    if (this.satellite) drawLines(this.stem, 1.5, 0.03, [wr, wg, wb, 0.55], null);

    if (this.satellite) {
      const sat = this.satellite;
      gl.useProgram(this.markerProgram);
      gl.uniformMatrix4fv(this.mu.u_viewProj, false, frame.viewProj);
      gl.uniform1f(this.mu.u_fold, fold);
      gl.uniform3f(this.mu.u_sat, sat.lon, sat.lat, sat.altKm / 6378.137);
      gl.uniform1f(this.mu.u_sizePx, 18 * dpr);
      gl.uniform3f(this.mu.u_eye, eye[0], eye[1], eye[2]);
      gl.uniform3f(this.mu.u_ink, wr, wg, wb);
      gl.uniform3f(this.mu.u_accent, ar, ag, ab);
      gl.uniform1f(this.mu.u_fadeBack, fadeBack);
      gl.bindVertexArray(this.markerVao);
      gl.drawArrays(gl.POINTS, 0, 1);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);

    // What is on screen, in attributes a test can read.
    const s = this.state();
    const d = this.canvas.dataset;
    d.ready = "true";
    d.style = this.style;
    d.flat = s.flat.toFixed(3);
    d.chase = s.chase.toFixed(3);
    d.view = s.flat === 0 ? "globe" : s.flat === 1 ? "map" : "folding";
    d.follow = this.follow;
    d.marker = s.markerNdc ? `${s.markerNdc[0].toFixed(4)},${s.markerNdc[1].toFixed(4)}` : "";
    d.heat = this.heatField ? "on" : "off";
    d.land = String(this.landMaskValues.reduce((n, v) => n + v, 0));
  }
}

function tokensPixel(c: Rgb): number[] {
  return [c[0], c[1], c[2], 255];
}
