// GLSL for the globes. Every drawn thing is a longitude, latitude and altitude. `foldPoint` turns
// it into a point on a sphere, a point on a map, or a point between, and it must stay the same
// arithmetic as foldPoint() in projection.ts. The browser test checks the two agree.

const COMMON = /* glsl */ `#version 300 es
precision highp float;
const float PI = 3.14159265359;
const float BULGE = 0.35;
vec3 sphereNormal(float lon, float lat) { return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon)); }
float smooth01(float x) { float c = clamp(x, 0.0, 1.0); return c * c * (3.0 - 2.0 * c); }
vec3 foldPoint(float lon, float lat, float alt, float e, float lift) {
  vec3 n = sphereNormal(lon, lat);
  vec3 s = (1.0 + alt) * n;
  vec3 m = vec3(lon, lat, lift);
  return mix(s, m, e) + n * (BULGE * sin(PI * e));
}
`;

export const SURFACE_VERT = `${COMMON}
in vec2 a_lonlat;
uniform mat4 u_viewProj;
uniform float u_fold;
out vec2 v_uv;
out vec3 v_normal;
out vec3 v_world;
void main() {
  vec3 w = foldPoint(a_lonlat.x, a_lonlat.y, 0.0, u_fold, 0.0);
  v_world = w;
  v_uv = vec2((a_lonlat.x + PI) / (2.0 * PI), (a_lonlat.y + PI / 2.0) / PI);
  v_normal = normalize(mix(sphereNormal(a_lonlat.x, a_lonlat.y), vec3(0.0, 0.0, 1.0), u_fold));
  gl_Position = u_viewProj * vec4(w, 1.0);
}
`;

export const SURFACE_FRAG = `${COMMON}
in vec2 v_uv;
in vec3 v_normal;
in vec3 v_world;
uniform sampler2D u_earth;
uniform sampler2D u_heat;
uniform float u_heatOn;
uniform vec3 u_eye;
uniform float u_fold;
uniform vec3 u_rim;
out vec4 outColor;
void main() {
  vec3 col = texture(u_earth, v_uv).rgb;
  vec4 h = texture(u_heat, v_uv);
  vec3 n = normalize(v_normal);
  vec3 light = normalize(vec3(-0.35, 0.45, 0.85));
  float lambert = max(dot(n, light), 0.0);
  col *= mix(0.42 + 0.58 * lambert, 1.0, u_fold);
  // The heat is laid over the lit surface, so the colours stay the design system's own, a little dimmer on the night side.
  col = mix(col, h.rgb * mix(0.7 + 0.3 * lambert, 1.0, u_fold), h.a * u_heatOn);
  vec3 view = normalize(u_eye - v_world);
  float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0) * (1.0 - u_fold);
  col += u_rim * rim * 0.55;
  outColor = vec4(col, 1.0);
}
`;

export const PARTICLE_VERT = `${COMMON}
in vec2 a_lonlat;
in float a_delay;
in float a_land;
in vec4 a_heat;
uniform mat4 u_viewProj;
uniform float u_flat;
uniform vec3 u_eye;
uniform float u_pointPx;
uniform float u_sizeRef;
uniform vec3 u_landColor;
uniform vec3 u_oceanColor;
out vec4 v_color;
void main() {
  float e = smooth01((u_flat - 0.5 * a_delay) / 0.5);
  vec3 w = foldPoint(a_lonlat.x, a_lonlat.y, 0.0, e, 0.0);
  vec3 n = sphereNormal(a_lonlat.x, a_lonlat.y);
  float facing = mix(dot(n, normalize(u_eye - w)), 1.0, e);
  float fade = mix(0.2, 1.0, smoothstep(-0.25, 0.1, facing));
  vec3 base = mix(u_oceanColor, u_landColor, a_land);
  vec3 col = a_heat.a > 0.0 ? a_heat.rgb : base;
  v_color = vec4(col, fade * mix(0.6, 1.0, a_land));
  gl_Position = u_viewProj * vec4(w, 1.0);
  // Dots grow as the camera closes in, so a chase view is not a few specks. The wide view is the reference.
  float near = clamp(u_sizeRef / gl_Position.w, 0.7, 3.5);
  gl_PointSize = u_pointPx * near * mix(0.55, 1.0, a_land) * mix(0.7, 1.0, fade);
}
`;

export const PARTICLE_FRAG = `${COMMON}
in vec4 v_color;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  outColor = vec4(v_color.rgb, v_color.a * (1.0 - smoothstep(0.55, 1.0, d)));
}
`;

export const LINE_VERT = `${COMMON}
in vec2 a_corner;
in vec3 a_p0;
in vec3 a_p1;
in vec2 a_time;
uniform mat4 u_viewProj;
uniform float u_fold;
uniform vec2 u_viewport;
uniform float u_widthPx;
uniform float u_lift;
uniform vec3 u_eye;
out float v_t;
out float v_lon;
out float v_front;
void main() {
  vec3 w0 = foldPoint(a_p0.x, a_p0.y, a_p0.z, u_fold, u_lift);
  vec3 w1 = foldPoint(a_p1.x, a_p1.y, a_p1.z, u_fold, u_lift);
  vec4 c0 = u_viewProj * vec4(w0, 1.0);
  vec4 c1 = u_viewProj * vec4(w1, 1.0);
  vec2 s0 = c0.xy / c0.w * u_viewport * 0.5;
  vec2 s1 = c1.xy / c1.w * u_viewport * 0.5;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = mix(c0, c1, a_corner.x);
  vec2 off = (nrm * a_corner.y + dir * (a_corner.x * 2.0 - 1.0)) * u_widthPx * 0.5;
  c.xy += off / (u_viewport * 0.5) * c.w;
  gl_Position = c;
  v_t = mix(a_time.x, a_time.y, a_corner.x);
  float lon = mix(a_p0.x, a_p1.x, a_corner.x);
  float lat = mix(a_p0.y, a_p1.y, a_corner.x);
  v_lon = lon;
  vec3 w = mix(w0, w1, a_corner.x);
  v_front = mix(dot(sphereNormal(lon, lat), normalize(u_eye - w)), 1.0, u_fold);
}
`;

export const LINE_FRAG = `${COMMON}
in float v_t;
in float v_lon;
in float v_front;
uniform vec4 u_pastColor;
uniform vec4 u_futureColor;
uniform float u_now;
uniform float u_useTime;
uniform float u_fold;
uniform float u_fadeBack;
out vec4 outColor;
void main() {
  vec4 col = u_useTime > 0.5 ? mix(u_futureColor, u_pastColor, step(v_t, u_now)) : u_pastColor;
  float visible = mix(1.0, mix(0.15, 1.0, smoothstep(-0.05, 0.15, v_front)), u_fadeBack);
  // The date-line cut runs a copy off each edge of the map. Fade it out as the sphere becomes the map.
  float outside = step(PI + 0.0006, abs(v_lon));
  visible *= 1.0 - outside * smoothstep(0.7, 0.95, u_fold);
  outColor = vec4(col.rgb, col.a * visible);
}
`;

export const MARKER_VERT = `${COMMON}
uniform mat4 u_viewProj;
uniform float u_fold;
uniform vec3 u_sat;
uniform float u_sizePx;
uniform vec3 u_eye;
out float v_front;
void main() {
  vec3 w = foldPoint(u_sat.x, u_sat.y, u_sat.z, u_fold, 0.04);
  gl_Position = u_viewProj * vec4(w, 1.0);
  gl_PointSize = u_sizePx;
  v_front = mix(dot(sphereNormal(u_sat.x, u_sat.y), normalize(u_eye - w)), 1.0, u_fold);
}
`;

export const MARKER_FRAG = `${COMMON}
in float v_front;
uniform vec3 u_ink;
uniform vec3 u_accent;
uniform float u_fadeBack;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0) discard;
  float ring = smoothstep(0.62, 0.72, d) * (1.0 - smoothstep(0.88, 0.98, d));
  float core = 1.0 - smoothstep(0.2, 0.3, d);
  float visible = mix(1.0, mix(0.3, 1.0, smoothstep(-0.05, 0.15, v_front)), u_fadeBack);
  outColor = vec4(mix(u_ink, u_accent, ring), max(ring, core) * visible);
}
`;
