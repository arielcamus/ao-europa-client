import { describe, expect, it } from 'vitest';
import { bodyHeadOffset, parseGraphics, parseIni, readBody } from '../src/assets.js';
import { ChatBubbles } from '../src/chat-bubbles.js';
import { WorldRenderer, tileDrawOrder } from '../src/renderer.js';

// #108: BodyData.HeadOffset is the ini HeadOffset plus BodyOffset (Recursos.bas CargarCuerpos). The world sprites used it since #67;
// the speech bubbles (engine.bas: PixelY + .Body.HeadOffset.y - 34) and the frmMapaGrande NPC preview read HeadOffsetY raw.
const bodies = parseIni("[BODY9]\nWalk1=1\nWalk2=1\nWalk3=1\nWalk4=1\nHeadOffsetX=2\nHeadOffsetY=-30\nBodyOffsetX=1\nBodyOffsetY=-12 ' montura\n[BODY10]\nHeadOffsetY=-26");

describe('BodyData.HeadOffset (CargarCuerpos: head offset + body offset)', () => {
  it('adds the body offset, strips a trailing VB comment, and is 0, 0 for a missing body', () => {
    expect(bodyHeadOffset(bodies, 9)).toEqual({ x: 3, y: -42 });
    expect(bodyHeadOffset(bodies, 10)).toEqual({ x: 0, y: -26 });
    expect(bodyHeadOffset(bodies, 77)).toEqual({ x: 0, y: 0 });
    const body = readBody(bodies, new Map(), parseGraphics('Grh1=1-3-0-0-32-32'), 9); // the sprites use the same rule
    expect([body.headX, body.headY]).toEqual([3, -42]);
  });

  it('speech bubbles sit on the combined offset', () => {
    const bubbles = new ChatBubbles({} as HTMLElement);
    (bubbles as unknown as { bodies: typeof bodies }).bodies = bodies;
    const headOffsetY = (id: number) => (bubbles as unknown as { headOffsetY(id: number): number }).headOffsetY(id);
    expect(headOffsetY(9)).toBe(-42);
    expect(headOffsetY(10)).toBe(-26);
  });

  it('the world-map NPC preview reports the combined offset', async () => {
    const renderer = Object.create(WorldRenderer.prototype) as WorldRenderer;
    Object.assign(renderer, { metadata: Promise.resolve(), bodies, heads: [], sprites: undefined });
    expect((await renderer.npcPreview(9, 0)).headOffsetY).toBe(-42);
  });
});

describe('characters in one row draw left to right by tile (RenderScreen "Layer 3 & chars")', () => {
  it('a walker mid-step keeps its tile slot: the logical tile decides, not the interpolated position', () => {
    // Row 50: A on tile 10 walking east (drawn at x 10.6), C on tile 11 walking west from 12 (drawn at 11.7), B on tile 12 walking south
    // from row 49 (drawn at y 49.8). VB6 loops x = MinBufferedX To MaxBufferedX over MapData(x, y).charindex: the tiles' order.
    const placed = [
      { name: 'C', row: 50, column: 11, x: 11.7, y: 50 },
      { name: 'A', row: 50, column: 10, x: 10.6, y: 50 },
      { name: 'D', row: 49, column: 30, x: 30, y: 49 },
      { name: 'B', row: 50, column: 12, x: 12, y: 49.8 },
    ];
    expect([...placed].sort(tileDrawOrder).map(p => p.name)).toEqual(['D', 'A', 'C', 'B']);
    // The old on-screen sort (y, then x) put B first in row 50 because it is still above the row mid-step.
    expect([...placed].sort((a, b) => a.y - b.y || a.x - b.x).map(p => p.name)).toEqual(['D', 'B', 'A', 'C']);
  });
});
