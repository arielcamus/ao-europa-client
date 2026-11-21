// wp11 scenario: the hotkey packets and the Goliath transfer packet against the real VB6 server, from a level-1 character with no banker nearby.
// SetHotkeySlot stores a slot (no answer), UseHKeySlot with a bound Item/empty slot does nothing, TransFerGold without a banker target is ignored.
import { i32, str } from './wire.mjs';
const i16 = n => [n & 255, (n >> 8) & 255];
export default async function run(rec) {
  rec.send(300, [0, ...i16(1), ...i16(1), 2]);            // slot 0 := spell 1 (last known slot 1), type Spell
  rec.send(300, [1, ...i16(-1), ...i16(-1), 3]);          // slot 1 cleared (Index -1, type Unknown), like ClearHotkeys
  await rec.sleep(400);
  rec.send(301, [0]); await rec.sleep(600);               // UseHKeySlot 0: the character knows no such spell
  rec.send(301, [1]); await rec.sleep(600);               // UseHKeySlot 1: empty
  rec.send(224, [...i32(10), ...str('Aotest')]); await rec.sleep(800); // TransFerGold: no banker targeted, ignored
}
