// AGPL-3.0-or-later. Probe: log in as the wp03 test character and list who is around (npc number, position).
import { Vb6Session, sleep } from './bank-trade-session.mjs';
const s = new Vb6Session({ email: process.env.AO_EMAIL ?? 'spells@local.test', password: process.env.AO_PASSWORD ?? 'spellspw1' });
await s.login(); await sleep(1500);
console.log('map', s.map, 'pos', s.pos, 'self', s.charIndex);
for (const [i, c] of s.chars) if (c.npc) console.log('npc', i, c.npcNumber, c.name, c.x, c.y);
s.close();
