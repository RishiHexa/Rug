/** A picture's pixels, as a canvas gives them: RGBA, row by row. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
