/** Saved designs, kept in this browser (IndexedDB). */
import { create } from 'zustand';
import { drawingSize, DrawDocument } from '../design/drawDocument';
import type { Crop } from '../design/upload';
import type { ClusterSettings } from '../domain/clustering';
import { gridSpecOf, type DimensionValues, type GridSpec, type Unit } from '../domain/dimensions';
import { makeCanvas } from '../segments/compose';
import type { Art, Segment, SegmentDoc } from '../segments/model';
import { useApp, type AppData, type DesignDraft, type DesignKind, type KnotMap } from './store';

export interface ProjectInfo {
  id: string;
  name: string;
  savedAt: number;
  widthIn: number;
  heightIn: number;
  /** Small picture, if there was anything to show. */
  thumb: Blob | null;
}

interface SavedArt {
  png: Blob;
  crisp: boolean;
}
type SavedSegment = Omit<Segment, 'art' | 'cornerArt'> & { art: SavedArt | null; cornerArt: SavedArt | null };
type SavedDoc = Omit<SegmentDoc, 'segments'> & { segments: SavedSegment[] };

interface SavedProject {
  id: string;
  version: 1;
  dimensions: DimensionValues & { unit: Unit; locked: boolean };
  source: DesignKind;
  image: Blob | null;
  designFinal: boolean;
  map: KnotMap | null;
  clusterSettings: ClusterSettings;
  resizeBase: { image: Blob; grid: GridSpec } | null;
  mode: DesignKind | null;
  upload: { name: string; png: Blob; crop: Crop } | null;
  draw: Blob | null;
  segments: SavedDoc | null;
}

/** The saved design that is open, so saving again updates it. */
export const useOpenProject = create<{ id: string | null; name: string }>()(() => ({ id: null, name: '' }));

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('rug-knot-map', 1);
    request.onupgradeneeded = () => {
      // The list is kept apart from the designs, which can be large.
      request.result.createObjectStore('info', { keyPath: 'id' });
      request.result.createObjectStore('designs', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Saved designs are not available.'));
  });
}

async function withStores<T>(
  mode: IDBTransactionMode,
  work: (info: IDBObjectStore, designs: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(['info', 'designs'], mode);
      const request = work(tx.objectStore('info'), tx.objectStore('designs'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('The browser refused to save.'));
    });
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const all = (await withStores('readonly', (info) => info.getAll() as IDBRequest<ProjectInfo[]>)) ?? [];
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await withStores('readwrite', (info, designs) => {
    info.delete(id);
    designs.delete(id);
    return null;
  });
  if (useOpenProject.getState().id === id) useOpenProject.setState({ id: null });
}

function toPng(source: HTMLCanvasElement | ImageBitmap): Promise<Blob> {
  let canvas: HTMLCanvasElement;
  if (source instanceof HTMLCanvasElement) {
    canvas = source;
  } else {
    canvas = makeCanvas(source.width, source.height);
    canvas.getContext('2d')!.drawImage(source, 0, 0);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('A picture could not be saved.'))), 'image/png'),
  );
}

async function fromPng(png: Blob): Promise<HTMLCanvasElement> {
  const image = await createImageBitmap(png);
  const canvas = makeCanvas(image.width, image.height);
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  image.close();
  return canvas;
}

const saveArt = async (art: Art | null): Promise<SavedArt | null> =>
  art && { png: await toPng(art.canvas), crisp: art.crisp };
const loadArt = async (art: SavedArt | null): Promise<Art | null> =>
  art && { canvas: await fromPng(art.png), crisp: art.crisp };

async function saveDoc(doc: SegmentDoc): Promise<SavedDoc> {
  const segments = await Promise.all(
    doc.segments.map(async (s) => ({ ...s, art: await saveArt(s.art), cornerArt: await saveArt(s.cornerArt) })),
  );
  return { ...doc, segments };
}
async function loadDoc(doc: SavedDoc): Promise<SegmentDoc> {
  const segments = await Promise.all(
    doc.segments.map(async (s) => ({ ...s, art: await loadArt(s.art), cornerArt: await loadArt(s.cornerArt) })),
  );
  return { ...doc, segments };
}

/** Small picture of the knot map, or of the design if there is no map. */
async function makeThumb(s: AppData): Promise<Blob | null> {
  const { map, grid } = s;
  let source: CanvasImageSource | null = s.design.image;
  if (map && grid) {
    const image = new ImageData(grid.columns, grid.rows);
    const px = new Uint32Array(image.data.buffer);
    const lut = map.palette.map((p) => {
      const n = parseInt(p.hex.slice(1), 16);
      return ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0;
    });
    for (let i = 0; i < px.length; i++) px[i] = lut[map.indices[i]!]!;
    const canvas = makeCanvas(grid.columns, grid.rows);
    canvas.getContext('2d')!.putImageData(image, 0, 0);
    source = canvas;
  }
  source ??= s.draft.mode === 'draw' ? (s.draft.draw?.canvas ?? null) : null;
  if (!source) return null;
  const { widthIn, heightIn } = gridSpecOf(s.dimensions);
  const scale = 160 / Math.max(widthIn, heightIn);
  const small = makeCanvas(widthIn * scale, heightIn * scale);
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, small.width, small.height);
  return toPng(small);
}

/** Saves everything. Without an id, a new saved design is made. */
export async function saveProject(name: string, id: string | null): Promise<void> {
  const s = useApp.getState();
  const { draft, design } = s;
  const key = id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const project: SavedProject = {
    id: key,
    version: 1,
    dimensions: s.dimensions,
    source: design.source,
    image: design.image && (await toPng(design.image)),
    designFinal: s.designFinal,
    map: s.map,
    clusterSettings: s.clusterSettings,
    resizeBase: s.resizeBase && { image: await toPng(s.resizeBase.image), grid: s.resizeBase.grid },
    mode: draft.mode,
    upload: draft.upload && {
      name: draft.upload.name,
      png: await toPng(draft.upload.image),
      crop: draft.upload.crop,
    },
    draw: draft.draw && !draft.draw.blank ? await toPng(draft.draw.canvas) : null,
    segments: draft.segments && (await saveDoc(draft.segments)),
  };
  const info: ProjectInfo = {
    id: key,
    name,
    savedAt: Date.now(),
    widthIn: s.dimensions.widthIn,
    heightIn: s.dimensions.heightIn,
    thumb: await makeThumb(s),
  };
  await withStores('readwrite', (infoStore, designs) => {
    infoStore.put(info);
    designs.put(project);
    return null;
  });
  useOpenProject.setState({ id: key, name });
}

export async function openProject(info: ProjectInfo): Promise<void> {
  const p = await withStores('readonly', (_, designs) => designs.get(info.id) as IDBRequest<SavedProject | undefined>);
  if (!p) throw new Error('That design is no longer there.');
  const grid = gridSpecOf(p.dimensions);
  const image = p.image && (await createImageBitmap(p.image));

  const draft: DesignDraft = { mode: p.mode, upload: null, draw: null, segments: null };
  if (p.upload) {
    draft.upload = {
      name: p.upload.name,
      image: await createImageBitmap(p.upload.png),
      url: URL.createObjectURL(p.upload.png),
      crop: p.upload.crop,
    };
  }
  if (p.draw) {
    draft.draw = new DrawDocument(drawingSize(grid));
    draft.draw.load(await fromPng(p.draw));
  }
  if (draft.mode === 'draw' && !draft.draw) draft.draw = new DrawDocument(drawingSize(grid));
  if (p.segments) draft.segments = await loadDoc(p.segments);

  useApp.getState().restore({
    dimensions: p.dimensions,
    grid: p.dimensions.locked ? { columns: grid.columns, rows: grid.rows } : null,
    design: { source: p.source, image, transforms: [] },
    designFinal: p.designFinal && image !== null,
    map: p.map,
    clusterSettings: p.clusterSettings,
    resizeBase: p.resizeBase && { image: await createImageBitmap(p.resizeBase.image), grid: p.resizeBase.grid },
    draft,
    step: p.map || p.designFinal ? 4 : image ? 3 : p.dimensions.locked ? 2 : 1,
  });
  useOpenProject.setState({ id: info.id, name: info.name });
}
