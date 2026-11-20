/*
 * Adapted to TypeScript 2026-11-20 from Aurora.Network Detail/Channel.cpp.
 * Copyright (C) 2018-2022 by Agustin Alvarez. All rights reserved.
 * This work is licensed under the terms of the Apache 2.0 license.
 * See ../../../LICENSES/Apache-2.0.txt and ../../../NOTICE.
 */
import { ProtocolError } from './binary.js';

export const MAX_FRAME_BODY = 0xffff;

/** Body includes the int16 packet ID; uint16 length excludes its own two bytes. */
export function encodeFrame(body: Uint8Array): Uint8Array {
  if (body.length < 2 || body.length > MAX_FRAME_BODY) {
    throw new ProtocolError(`Invalid frame body length ${body.length}`);
  }
  const frame = new Uint8Array(body.length + 2);
  new DataView(frame.buffer).setUint16(0, body.length, true);
  frame.set(body, 2);
  return frame;
}

/** Bounded byte accumulator: retains at most one partial frame; copies each byte once. */
export class FrameDecoder {
  private readonly buffer = new Uint8Array(MAX_FRAME_BODY + 2);
  private size = 0;
  private expected = 2;
  private failed = false;

  get pendingBytes(): number { return this.size; }

  push(chunk: Uint8Array): Uint8Array[] {
    if (this.failed) throw new ProtocolError('Frame decoder stopped after malformed input');
    const frames: Uint8Array[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      const count = Math.min(this.expected - this.size, chunk.length - offset);
      this.buffer.set(chunk.subarray(offset, offset + count), this.size);
      offset += count;
      this.size += count;
      if (this.size !== this.expected) continue;
      if (this.expected === 2) {
        const length = this.buffer[0]! + this.buffer[1]! * 256;
        if (length < 2) {
          this.failed = true;
          throw new ProtocolError(`Invalid frame body length ${length}; packet id unavailable`);
        }
        this.expected = length + 2;
      } else {
        frames.push(this.buffer.slice(2, this.size));
        this.size = 0;
        this.expected = 2;
      }
    }
    return frames;
  }

  /** Call on EOF and before declaring a session successful. */
  finish(): void {
    if (this.failed) throw new ProtocolError('Frame decoder stopped after malformed input');
    if (this.size > 0) {
      this.failed = true;
      const id = this.size >= 4 ? new DataView(this.buffer.buffer).getInt16(2, true) : 'unavailable';
      throw new ProtocolError(`Truncated frame: ${this.size}/${this.expected} bytes, packet id=${id}`);
    }
  }
}
