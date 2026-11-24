/**
 * Color conversion. culori handles single colors; the per-knot loop uses an
 * allocation-free version of the same math (checked against culori in tests).
 */
import { converter, formatHex } from 'culori';

export type Oklab = [L: number, a: number, b: number];

const toOklab = converter('oklab');

export function hexToOklab(hex: string): Oklab {
  const c = toOklab(hex);
  if (!c) throw new Error(`Not a color: ${hex}`);
  return [c.l, c.a, c.b];
}

export function oklabToHex([l, a, b]: Oklab): string {
  return formatHex({ mode: 'oklab', l, a, b });
}

/** sRGB byte → linear-light 0..1. */
export const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** Writes the OKLab value of a linear-light RGB color into `out` at `o`. */
export function linearToOklab(r: number, g: number, b: number, out: Float32Array, o: number): void {
  const l = Math.cbrt(0.412221469470763 * r + 0.5363325372617348 * g + 0.0514459932675022 * b);
  const m = Math.cbrt(0.2119034958178252 * r + 0.6806995506452344 * g + 0.1073969535369406 * b);
  const s = Math.cbrt(0.0883024591900564 * r + 0.2817188391361215 * g + 0.6299787016738222 * b);
  out[o] = 0.210454268309314 * l + 0.7936177747023054 * m - 0.0040720430116193 * s;
  out[o + 1] = 1.9779985324311684 * l - 2.4285922420485799 * m + 0.450593709617411 * s;
  out[o + 2] = 0.0259040424655478 * l + 0.7827717124575296 * m - 0.8086757549230774 * s;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
