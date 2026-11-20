// AGPL-3.0-or-later. See ../../../LICENSE. Browser-compatible VB6 file primitives.
export class FormatError extends Error {
  override name = 'FormatError';
}

export class BinaryReader {
  private readonly view: DataView;
  offset = 0;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining(): number { return this.bytes.length - this.offset; }
  skip(size: number): number {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.remaining) {
      throw new FormatError(`Truncated resource at byte ${this.offset} (need ${size}, have ${this.remaining})`);
    }
    const start = this.offset;
    this.offset += size;
    return start;
  }
  u8(): number { return this.view.getUint8(this.skip(1)); }
  u16(): number { return this.view.getUint16(this.skip(2), true); }
  i16(): number { return this.view.getInt16(this.skip(2), true); }
  i32(): number { return this.view.getInt32(this.skip(4), true); }
  f32(): number { return this.view.getFloat32(this.skip(4), true); }
  /** VB6 binary UDT strings use a uint16 byte length and the Windows ANSI code page. */
  string(): string {
    const size = this.u16();
    const start = this.skip(size);
    return new TextDecoder('windows-1252').decode(this.bytes.subarray(start, start + size));
  }
  count(max = 10_000): number {
    const count = this.i32();
    if (count < 0 || count > max) throw new FormatError(`Invalid count ${count}`);
    return count;
  }
  end(): void { if (this.remaining) throw new FormatError(`Unexpected ${this.remaining} trailing bytes`); }
}
