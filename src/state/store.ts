import { create } from 'zustand';
import {
  applyEdit,
  derive,
  gridProblem,
  gridSpecOf,
  type DimensionField,
  type DimensionValues,
  type GridSpec,
  type Unit,
} from '../domain/dimensions';
import { hexToOklab, type ClusterSettings, type Palette } from '../domain/clustering';
import type { DesignTransform } from '../domain/pipeline';
import { drawingSize, DrawDocument } from '../design/drawDocument';
import { largestCrop, matchesAspect, type UploadDraft } from '../design/upload';
import type { SegmentDoc } from '../segments/model';

/** 5 is the rug preview, 6 is resizing. */
export type Step = 1 | 2 | 3 | 4 | 5 | 6;
export type DesignKind = 'upload' | 'draw' | 'segments';

export interface KnotMap {
  indices: Uint16Array;
  palette: Palette[];
  detectedPalette: Palette[];
}

/** Step 2 work in progress, kept so going back never loses it. */
export interface DesignDraft {
  mode: DesignKind | null;
  upload: UploadDraft | null;
  draw: DrawDocument | null;
  segments: SegmentDoc | null;
}

/** The design before any resizing, so resizing never wears it out. */
export interface ResizeBase {
  image: ImageBitmap;
  grid: GridSpec;
}

export interface ResizeResult {
  widthIn: number;
  heightIn: number;
  image: ImageBitmap;
  indices: Uint16Array;
}

export type MapJob =
  | { status: 'idle' }
  | { status: 'running'; stage: string; progress: number }
  | { status: 'error'; message: string };

export interface AppData {
  step: Step;
  dimensions: DimensionValues & { unit: Unit; locked: boolean };
  grid: { columns: number; rows: number } | null;
  design: { source: DesignKind; image: ImageBitmap | null; transforms: DesignTransform[] };
  designFinal: boolean;
  map: KnotMap | null;
  clusterSettings: ClusterSettings;
  draft: DesignDraft;
  job: MapJob;
  resizeBase: ResizeBase | null;
  /** Counts opened designs, so screens start afresh for each. */
  session: number;
}

interface AppActions {
  goTo(step: Step): void;
  editDimension(field: DimensionField, value: number): void;
  setUnit(unit: Unit): void;
  /**
   * Sets the rug's width and height while designing with segments, which
   * follow any size by their rules. Step 1 shows the new size.
   */
  resizeRug(widthIn: number, heightIn: number): void;
  lockDimensions(): void;
  /** Unlocks step 1 and discards everything downstream. */
  unlockDimensions(): void;
  setDraft(patch: Partial<DesignDraft>): void;
  /** The draft changed, so any image produced from it is stale. */
  invalidateDesign(): void;
  setDesignImage(source: DesignKind, image: ImageBitmap): void;
  finaliseDesign(): void;
  /** Unlocks the design and discards the knot map. */
  unlockDesign(): void;
  setClusterSettings(settings: ClusterSettings): void;
  setJob(job: MapJob): void;
  setMap(indices: Uint16Array, palette: Palette[]): void;
  setClusterColor(index: number, hex: string): void;
  resetClusterColor(index: number): void;
  /** The rug at a new size, in the colors it already has. */
  applyResize(result: ResizeResult): void;
  /** Replaces everything with a saved design. */
  restore(data: Partial<AppData>): void;
}

export type AppState = AppData & AppActions;

export const DEFAULT_CLUSTER_SETTINGS: ClusterSettings = {
  targetColorCount: 20,
  minColorDifference: 0.05,
};

const EMPTY_DRAFT: DesignDraft = { mode: null, upload: null, draw: null, segments: null };
const NO_MAP = { map: null, job: { status: 'idle' } as MapJob, resizeBase: null };

export const useApp = create<AppState>()((set, get) => {
  const replaceColor = (index: number, next: (current: Palette, detected: Palette) => Palette) => {
    const { map } = get();
    const current = map?.palette[index];
    const detected = map?.detectedPalette[index];
    if (!map || !current || !detected) return;
    const palette = map.palette.slice();
    palette[index] = next(current, detected);
    set({ map: { ...map, palette } });
  };

  return {
    step: 1,
    dimensions: { widthIn: 108, heightIn: 144, warp: 10, weft: 10, unit: 'ftin', locked: false },
    grid: null,
    design: { source: 'upload', image: null, transforms: [] },
    designFinal: false,
    map: null,
    clusterSettings: DEFAULT_CLUSTER_SETTINGS,
    draft: EMPTY_DRAFT,
    job: { status: 'idle' },
    resizeBase: null,
    session: 0,

    goTo: (step) => {
      if (canEnter(get(), step)) set({ step });
    },
    editDimension: (field, value) => {
      const { dimensions } = get();
      if (dimensions.locked) return;
      set({ dimensions: { ...dimensions, ...applyEdit(dimensions, field, value) } });
    },
    setUnit: (unit) => set({ dimensions: { ...get().dimensions, unit } }),
    resizeRug: (widthIn, heightIn) => {
      const { dimensions, draft, design, designFinal } = get();
      if (!dimensions.locked || designFinal) return;
      if (widthIn === dimensions.widthIn && heightIn === dimensions.heightIn) return;
      const next = { ...dimensions, widthIn, heightIn };
      const d = derive(next);
      if (gridProblem(d)) return;
      set({
        dimensions: next,
        grid: { columns: d.columns, rows: d.rows },
        design: { ...design, image: null },
        draft: fitDraft(draft, null, next),
        ...NO_MAP,
      });
    },
    lockDimensions: () => {
      const { dimensions } = get();
      const d = derive(dimensions);
      if (gridProblem(d)) return;
      set({
        dimensions: { ...dimensions, locked: true },
        grid: { columns: d.columns, rows: d.rows },
        step: 2,
      });
    },
    unlockDimensions: () => {
      const { upload, segments, mode } = get().draft;
      if (upload) URL.revokeObjectURL(upload.url);
      set({
        step: 1,
        dimensions: { ...get().dimensions, locked: false },
        grid: null,
        design: { ...get().design, image: null },
        designFinal: false,
        // Segments follow their rules to any size, so they are kept.
        draft: { ...EMPTY_DRAFT, segments, mode: mode === 'segments' ? mode : null },
        clusterSettings: DEFAULT_CLUSTER_SETTINGS,
        ...NO_MAP,
      });
    },
    setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),
    invalidateDesign: () => {
      const { design } = get();
      if (design.image) set({ design: { ...design, image: null }, designFinal: false, ...NO_MAP });
    },
    setDesignImage: (source, image) =>
      set({ design: { ...get().design, source, image }, designFinal: false, ...NO_MAP, step: 3 }),
    finaliseDesign: () => {
      if (get().design.image) set({ designFinal: true, step: 4 });
    },
    unlockDesign: () => {
      const { draft, design, dimensions } = get();
      set({ designFinal: false, step: 2, draft: fitDraft(draft, design.image, dimensions), ...NO_MAP });
    },
    setClusterSettings: (clusterSettings) => set({ clusterSettings }),
    setJob: (job) => set({ job }),
    setMap: (indices, palette) =>
      set({ map: { indices, palette, detectedPalette: palette }, job: { status: 'idle' } }),
    setClusterColor: (index, hex) =>
      replaceColor(index, (current) => ({ ...current, hex, oklab: hexToOklab(hex) })),
    resetClusterColor: (index) => replaceColor(index, (_, detected) => detected),
    applyResize: ({ widthIn, heightIn, image, indices }) => {
      const { dimensions, design, map, resizeBase } = get();
      if (!map || !design.image) return;
      const counts = new Uint32Array(map.palette.length);
      for (let i = 0; i < indices.length; i++) counts[indices[i]!]!++;
      const recount = (palette: Palette[]) => palette.map((p, i) => ({ ...p, knotCount: counts[i]! }));
      const next = { ...dimensions, widthIn, heightIn };
      const { columns, rows } = gridSpecOf(next);
      set({
        dimensions: next,
        grid: { columns, rows },
        design: { ...design, image },
        map: { indices, palette: recount(map.palette), detectedPalette: recount(map.detectedPalette) },
        job: { status: 'idle' },
        resizeBase: resizeBase ?? { image: design.image, grid: gridSpecOf(dimensions) },
      });
    },
    restore: (data) => {
      const { upload } = get().draft;
      if (upload) URL.revokeObjectURL(upload.url);
      set({ ...NO_MAP, draft: EMPTY_DRAFT, clusterSettings: DEFAULT_CLUSTER_SETTINGS, ...data, session: get().session + 1 });
    },
  };
});

/** After a resize, work in progress no longer has the rug's shape. */
function fitDraft(draft: DesignDraft, image: ImageBitmap | null, dimensions: DimensionValues): DesignDraft {
  const grid = gridSpecOf(dimensions);
  const aspect = grid.widthIn / grid.heightIn;
  let { upload, draw } = draft;
  if (upload && !matchesAspect(upload.crop.width, upload.crop.height, aspect)) {
    upload = { ...upload, crop: largestCrop(upload.image.width, upload.image.height, aspect) };
  }
  if (draw) {
    const size = drawingSize(grid);
    if (size.width !== draw.width || size.height !== draw.height) {
      const source = draft.mode === 'draw' && image ? image : draw.canvas;
      const { blank } = draw;
      draw = new DrawDocument(size);
      draw.load(source);
      draw.blank = blank;
    }
  }
  return { ...draft, upload, draw };
}

export function canEnter(s: AppData, step: Step): boolean {
  switch (step) {
    case 1:
      return true;
    case 2:
      return s.dimensions.locked;
    case 3:
      return s.dimensions.locked && s.design.image !== null;
    case 4:
      return s.designFinal;
    case 5:
    case 6:
      return s.map !== null;
  }
}

export function isComplete(s: AppData, step: Step): boolean {
  switch (step) {
    case 1:
      return s.dimensions.locked;
    case 2:
      return s.design.image !== null;
    case 3:
      return s.designFinal;
    case 4:
      return s.map !== null;
    case 5:
    case 6:
      return false;
  }
}

/** What unlocking dimensions would throw away, in words; null when nothing. */
export function downstreamOfDimensions(s: AppData): string | null {
  // A segment design adapts to the new size by itself.
  if (s.draft.mode === 'segments' && !s.draft.upload && !s.draft.draw) {
    return s.designFinal ? 'the knot map' : null;
  }
  const hasDesign = s.design.image !== null || s.draft.upload !== null || s.draft.draw !== null;
  if (s.designFinal) return 'the design and the knot map';
  return hasDesign ? 'the design' : null;
}

/** The locked grid with its physical size. */
export function gridSpec(s: Pick<AppData, 'dimensions'>): GridSpec {
  return gridSpecOf(s.dimensions);
}

export function hasColorEdits(map: KnotMap | null): boolean {
  return map !== null && map.palette.some((p, i) => p.hex !== map.detectedPalette[i]!.hex);
}
