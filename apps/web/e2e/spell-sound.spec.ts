import { test, expect } from '@playwright/test';
import { NpcsServerPacketId as N, ServerPacketId as S, SpellServerPacketId as SS, encodeServerFrame } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';

// "Dardo Mágico makes no noise when cast" (21 Nov). The pinned server sends a killing travelling spell as ParticleFXWithDestino (the NPC as
// emitter and receptor, wave 16) and the NPC's CharacterRemove in the SAME batch (tests/fixtures/vb6/spells/dardo-magico-kills-creature.jsonl).
// In the real page loop the effect must still fly to the erased creature's tile and play its wave there.
test('a killing Dardo Mágico still plays its wave when the effect lands on the erased creature\'s tile', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one browser is enough: this is the frame loop, not the layout');
  await page.goto('/?audiodebug');
  await expect(page.locator('#mode')).toHaveText('TEST STAND-IN');
  await page.getByRole('button', { name: 'Enter world' }).click(); // also the gesture that unlocks audio
  await expect(page.locator('#connection')).toHaveText('Connected', { timeout: 20_000 });
  await expect(page.locator('#position')).toHaveText('50, 50');
  const frame = (packet: ServerPacket) => [...encodeServerFrame(packet)];
  const gallo = frame({ id: S.CharacterCreate, charIndex: 5434, body: 4050, head: 0, heading: 3, x: 51, y: 50, weapon: 0, shield: 0, helmet: 0, cart: 0, backpack: 0, fx: 0, fxLoops: 0, name: '', status: 0, privileges: 0, particleFx: 0, headAura: '0', weaponAura: '0', bodyAura: '0', damageAura: '0', resistanceAura: '0', otherAura: '0', shieldAura: '0', speeding: 0.45, npc: 1, appear: 0, groupIndex: 0, clanIndex: 0, clanLevel: 0, minHp: 15, maxHp: 15, minMana: 0, maxMana: 0, symbol: 0, flags: 0, userType: 0, team: 0, flag: 0, npcNumber: 501, clanAlignment: 0 } as ServerPacket);
  const kill = [
    ...frame({ id: SS.ParticleFXWithDestino, sender: 5434, receiver: 5434, travelParticle: 186, finalParticle: 15, time: 0, wave: 16, fx: 1, x: 0, y: 0 } as ServerPacket),
    ...frame({ id: N.CharacterRemove, charIndex: 5434, vanish: true, warp: false } as ServerPacket),
  ];
  const audio = () => page.evaluate(() => (globalThis as unknown as { __aoAudio: { engine: { events: Array<{ kind: string; id: string; volume?: number }> } } }).__aoAudio.engine.events.filter(e => e.kind === 'wave' && e.id === '16'));
  const feed = (bytes: number[]) => page.evaluate(b => (globalThis as unknown as { __aoAudio: { world: { session: { receive(u: Uint8Array): void } } } }).__aoAudio.world.session.receive(new Uint8Array(b)), bytes);
  await feed(gallo);
  await page.waitForTimeout(300);
  await feed(kill); // one batch: the creature is gone before the next frame renders
  await expect.poll(audio, { timeout: 5000 }).toHaveLength(1);
  // one tile away from the player: one step of VB6 distance attenuation
  expect((await audio())[0]!.volume).toBe(-120);
});
