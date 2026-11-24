import type { GridSpec } from './dimensions';

export type DesignSource = {
  kind: 'upload' | 'draw' | 'segments';
  produce(): Promise<ImageBitmap>;
};

export type DesignTransform = {
  id: string;
  apply(img: ImageBitmap, grid: GridSpec): Promise<ImageBitmap>;
};

/** Produces the source image and runs it through every transform in order. */
export async function runDesignPipeline(
  source: DesignSource,
  transforms: readonly DesignTransform[],
  grid: GridSpec,
): Promise<ImageBitmap> {
  return transforms.reduce<Promise<ImageBitmap>>(
    async (img, transform) => transform.apply(await img, grid),
    source.produce(),
  );
}
