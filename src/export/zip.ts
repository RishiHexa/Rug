import { Deflater, utf8, type Bytes } from './deflate';

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

interface Entry {
  name: Bytes;
  crc: number;
  size: number;
  packed: number;
  offset: number;
}

/** Writes a zip file entry by entry. Sizes stay below the 4 GB zip limit. */
export class ZipWriter {
  private readonly parts: Bytes[] = [];
  private readonly entries: Entry[] = [];
  private offset = 0;

  async add(name: string, chunks: Iterable<string> | AsyncIterable<string>): Promise<void> {
    const deflater = new Deflater('deflate-raw');
    let crc = 0xffffffff;
    let size = 0;
    for await (const chunk of chunks) {
      const data = utf8(chunk);
      for (let i = 0; i < data.length; i++) crc = CRC[(crc ^ data[i]!) & 255]! ^ (crc >>> 8);
      size += data.length;
      await deflater.write(data);
    }
    const packed = await deflater.finish();
    const entry: Entry = {
      name: utf8(name),
      crc: (crc ^ 0xffffffff) >>> 0,
      size,
      packed: packed.size,
      offset: this.offset,
    };
    this.entries.push(entry);
    this.push(record(0x04034b50, entry, false), entry.name, ...packed.parts);
  }

  finish(type: string): Blob {
    const start = this.offset;
    for (const entry of this.entries) this.push(record(0x02014b50, entry, true), entry.name);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, this.offset - start, true);
    end.setUint32(16, start, true);
    this.push(new Uint8Array(end.buffer));
    return new Blob(this.parts, { type });
  }

  private push(...parts: Bytes[]): void {
    for (const part of parts) {
      this.parts.push(part);
      this.offset += part.length;
    }
  }
}

/** Local file header, or the matching record in the central directory. */
function record(signature: number, e: Entry, central: boolean): Bytes {
  const view = new DataView(new ArrayBuffer(central ? 46 : 30));
  view.setUint32(0, signature, true);
  let at = 4;
  const u16 = (v: number) => {
    view.setUint16(at, v, true);
    at += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(at, v, true);
    at += 4;
  };
  if (central) u16(20); // made by
  u16(20); // version needed
  u16(0x0800); // names are UTF-8
  u16(8); // deflate
  u16(0); // time
  u16(0x21); // date: 1980-01-01
  u32(e.crc);
  u32(e.packed);
  u32(e.size);
  u16(e.name.length);
  u16(0); // extra field
  if (central) {
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(e.offset);
  }
  return new Uint8Array(view.buffer);
}
