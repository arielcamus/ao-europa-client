/*
 * Adapted to TypeScript 2026-11-20 from Aurora.Network Writer.hpp, Reader.hpp,
 * COM_Writer.cpp and COM_Reader.cpp.
 * Copyright (C) 2018-2022 by Agustin Alvarez. All rights reserved.
 * This work is licensed under the terms of the Apache 2.0 license.
 * See ../../../LICENSES/Apache-2.0.txt and ../../../NOTICE.
 */

export class ProtocolError extends Error {
  override name = 'ProtocolError';
}

function integer(value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ProtocolError(`Integer ${value} outside ${min}..${max}`);
  }
}

export interface SafeArrayInt8 {
  /** COM rgsabound order on the wire; not reversed into language array order. */
  bounds: { lowerBound: number; count: number }[];
  data: Uint8Array;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export class Writer {
  private buffer = new Uint8Array(128);
  private offset = 0;

  private reserve(size: number): DataView {
    if (this.offset + size > this.buffer.length) {
      const next = new Uint8Array(Math.max(this.buffer.length * 2, this.offset + size));
      next.set(this.buffer);
      this.buffer = next;
    }
    const view = new DataView(this.buffer.buffer, this.offset, size);
    this.offset += size;
    return view;
  }

  writeBytes(bytes: Uint8Array): this {
    const view = this.reserve(bytes.length);
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength).set(bytes);
    return this;
  }

  writeBool(value: boolean): this { return this.writeInt8(value ? 1 : 0); }

  /** VB Byte is unsigned, even though COM calls the method WriteInt8. */
  writeInt8(value: number): this {
    integer(value, 0, 0xff);
    this.reserve(1).setUint8(0, value);
    return this;
  }

  writeInt16(value: number): this {
    integer(value, -0x8000, 0x7fff);
    this.reserve(2).setInt16(0, value, true);
    return this;
  }

  writeInt32(value: number): this {
    integer(value, -0x8000_0000, 0x7fff_ffff);
    this.reserve(4).setInt32(0, value, true);
    return this;
  }

  writeReal32(value: number): this {
    if (!Number.isFinite(Math.fround(value))) throw new ProtocolError('Non-finite Real32');
    this.reserve(4).setFloat32(0, value, true);
    return this;
  }

  /** Exact COM signed vbInt32 specialization: negative values are lossy. No ZigZag. */
  writeInt(value: number): this {
    integer(value, -0x8000_0000, 0x7fff_ffff);
    if (value < 0) return this.writeInt8(value & 0x7f);
    return this.writeUnsignedInt(value);
  }

  /** Unsigned specialization used for string byte counts and SAFEARRAY bounds. */
  writeUnsignedInt(value: number): this {
    integer(value, 0, 0xffff_ffff);
    while (value > 0x7f) {
      this.writeInt8((value & 0x7f) | 0x80);
      value = Math.floor(value / 128);
    }
    return this.writeInt8(value);
  }

  writeString(value: string): this {
    const bytes = utf8Encoder.encode(value);
    this.writeUnsignedInt(bytes.length);
    return this.writeBytes(bytes);
  }

  writeSafeArrayInt8(value: SafeArrayInt8): this {
    integer(value.bounds.length, 1, 0xffff);
    let quantity = 1;
    for (const bound of value.bounds) {
      integer(bound.lowerBound, -0x8000_0000, 0x7fff_ffff);
      integer(bound.count, 0, 0xffff_ffff);
      quantity *= bound.count;
      if (!Number.isSafeInteger(quantity)) throw new ProtocolError('SAFEARRAY size overflow');
    }
    if (quantity !== value.data.length) throw new ProtocolError('SAFEARRAY data size mismatch');
    this.writeUnsignedInt(value.bounds.length);
    for (const bound of value.bounds) {
      this.writeUnsignedInt(bound.lowerBound >>> 0).writeUnsignedInt(bound.count);
    }
    return this.writeBytes(value.data);
  }

  toBytes(): Uint8Array { return this.buffer.slice(0, this.offset); }
}

export class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number { return this.bytes.length - this.offset; }

  private take(size: number): number {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.remaining) {
      throw new ProtocolError(`Truncated field at offset ${this.offset}: need ${size}, have ${this.remaining}`);
    }
    const start = this.offset;
    this.offset += size;
    return start;
  }

  readBytes(size: number): Uint8Array {
    const start = this.take(size);
    return this.bytes.slice(start, start + size);
  }

  skip(size: number): void { this.take(size); }
  readInt8(): number { return this.view.getUint8(this.take(1)); }
  readInt16(): number { return this.view.getInt16(this.take(2), true); }
  readInt32(): number { return this.view.getInt32(this.take(4), true); }
  readReal32(): number { return this.view.getFloat32(this.take(4), true); }

  readBool(): boolean {
    const value = this.readInt8();
    if (value > 1) throw new ProtocolError(`Invalid bool ${value}`);
    return value === 1;
  }

  readUnsignedInt(): number {
    let value = 0;
    for (let index = 0; index < 5; index++) {
      const byte = this.readInt8();
      if (index === 4 && byte > 0x0f) throw new ProtocolError('Varint exceeds 32 bits');
      value += (byte & 0x7f) * 2 ** (7 * index);
      if ((byte & 0x80) === 0) return value;
    }
    throw new ProtocolError('Unterminated varint');
  }

  readInt(): number { return this.readUnsignedInt() | 0; }

  readString(): string {
    const bytes = this.readBytes(this.readUnsignedInt());
    try { return utf8Decoder.decode(bytes); }
    catch { throw new ProtocolError('Invalid UTF-8 string'); }
  }

  readSafeArrayInt8(): SafeArrayInt8 {
    const dimensions = this.readUnsignedInt();
    // At least two bytes per dimension; bound work by available input.
    if (dimensions < 1 || dimensions > 0xffff || dimensions > this.remaining / 2) {
      throw new ProtocolError('Invalid SAFEARRAY dimensions');
    }
    const bounds: SafeArrayInt8['bounds'] = [];
    let quantity = 1;
    for (let index = 0; index < dimensions; index++) {
      const lowerBound = this.readUnsignedInt() | 0;
      const count = this.readUnsignedInt();
      quantity *= count;
      if (!Number.isSafeInteger(quantity)) throw new ProtocolError('SAFEARRAY size overflow');
      bounds.push({ lowerBound, count });
    }
    return { bounds, data: this.readBytes(quantity) };
  }

  end(): void {
    if (this.remaining !== 0) throw new ProtocolError(`${this.remaining} trailing bytes in one-message frame`);
  }
}
