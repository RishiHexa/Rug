export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
export const utf8 = (text: string): Bytes => encoder.encode(text) as Bytes;

/** Compresses data piece by piece, so large files never exist uncompressed. */
export class Deflater {
  private readonly writer: WritableStreamDefaultWriter<BufferSource>;
  private readonly output: Promise<Bytes[]>;

  /** `deflate` is what PDF streams use, `deflate-raw` is what zip files use. */
  constructor(format: 'deflate' | 'deflate-raw') {
    const stream = new CompressionStream(format);
    this.writer = stream.writable.getWriter();
    this.output = collect(stream.readable as ReadableStream<Bytes>);
  }

  write(data: Bytes): Promise<void> {
    return this.writer.write(data);
  }

  async finish(): Promise<{ parts: Bytes[]; size: number }> {
    await this.writer.close();
    const parts = await this.output;
    return { parts, size: parts.reduce((n, p) => n + p.length, 0) };
  }
}

async function collect(stream: ReadableStream<Bytes>): Promise<Bytes[]> {
  const parts: Bytes[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return parts;
    parts.push(value);
  }
}
