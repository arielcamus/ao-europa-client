// AGPL-3.0-or-later. Undo for world-record.mjs: one /LLUVIA flips rain and snow together; prints the toggles received.
import { launch } from './world-drive.mjs';
const gm = await launch({ email: process.env.AO_EMAIL, password: process.env.AO_PASSWORD, port: process.env.AO_WEB_PORT });
const mark = gm.wire.length; await gm.say('/LLUVIA'); await new Promise(r => setTimeout(r, 1500));
console.log(gm.wire.slice(mark).filter(w => w.dir === 's2c' && [59, 122].includes(w.id)).map(w => `${w.id}:${w.hex.slice(-2)}`));
await gm.close();
