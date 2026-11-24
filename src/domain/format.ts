/** Palette labels, worded the same on screen and in exported files. */

export const colorId = (id: number) => `C${String(id).padStart(2, '0')}`;

export function percent(fraction: number): string {
  const p = fraction * 100;
  return p < 0.1 ? '<0.1%' : `${p.toFixed(1)}%`;
}
