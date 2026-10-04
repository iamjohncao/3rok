// Column-major 4x4 matrices, the layout WebGL wants. Only what the globe camera needs.

import type { Vec3 } from "../oem";
import { cross, dot, sub, unit } from "../engine/vec";

export type Mat4 = Float32Array;

export function perspective(fovYRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovYRad / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const zAxis = unit(sub(eye, target));
  let xAxis = unit(cross(up, zAxis));
  if (xAxis[0] === 0 && xAxis[1] === 0 && xAxis[2] === 0) xAxis = [1, 0, 0];
  const yAxis = cross(zAxis, xAxis);
  const out = new Float32Array(16);
  out[0] = xAxis[0]; out[1] = yAxis[0]; out[2] = zAxis[0];
  out[4] = xAxis[1]; out[5] = yAxis[1]; out[6] = zAxis[1];
  out[8] = xAxis[2]; out[9] = yAxis[2]; out[10] = zAxis[2];
  out[12] = -dot(xAxis, eye); out[13] = -dot(yAxis, eye); out[14] = -dot(zAxis, eye);
  out[15] = 1;
  return out;
}

/** a * b. Applying the product to a point applies b first, then a. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** A point through a matrix: clip coordinates, then normalized device coordinates. */
export function toNdc(m: Mat4, p: Vec3): { x: number; y: number; w: number } {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return { x: x / w, y: y / w, w };
}
