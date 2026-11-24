import { expect, it } from 'vitest';
import type { GridSpec } from './dimensions';
import { runDesignPipeline, type DesignTransform } from './pipeline';

const grid: GridSpec = { columns: 1, rows: 1, widthIn: 1, heightIn: 1 };
// The pipeline never looks inside the bitmap, so tagged stand-ins are enough.
const bitmap = (tag: string) => ({ tag }) as unknown as ImageBitmap;
const tagOf = (b: ImageBitmap) => (b as unknown as { tag: string }).tag;

const append = (id: string): DesignTransform => ({
  id,
  apply: async (img) => bitmap(tagOf(img) + id),
});

it('returns the source image untouched when there are no transforms', async () => {
  const src = bitmap('src');
  expect(await runDesignPipeline({ kind: 'draw', produce: async () => src }, [], grid)).toBe(src);
});

it('applies transforms in order', async () => {
  const out = await runDesignPipeline(
    { kind: 'upload', produce: async () => bitmap('s') },
    [append('a'), append('b')],
    grid,
  );
  expect(tagOf(out)).toBe('sab');
});
