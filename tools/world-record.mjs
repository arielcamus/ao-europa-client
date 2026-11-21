// AGPL-3.0-or-later. Records VB6 fixtures for the world package (tests/fixtures/vb6/world/*.jsonl): rain and snow toggles (GM /LLUVIA, /NIEVE, sent to
// everybody). NOTE /LLUVIA flips rain AND snow together (Protocol_GmCommands 2227-2228); undo with tools/world-weather-reset.mjs when the state is not off/off.
// Usage: AO_WEB_PORT=5785 AO_EMAIL=aotest@local.test AO_PASSWORD=.. node tools/world-record.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch } from './world-drive.mjs';
const NAMES = { 54: 'PlayMIDI', 59: 'RainToggle', 122: 'NieveToggle', 188: 'PlayWaveStep', 305: 'LoginAccount', 73: 'LoginExistingChar' };
const email = process.env.AO_EMAIL, password = process.env.AO_PASSWORD, port = process.env.AO_WEB_PORT;
const rows = (wire, keep) => wire.filter(keep).map((w, i) => ({ t_ms: i, dir: w.dir, id: w.id, name: NAMES[w.id] ?? `id${w.id}`, hex: (w.id === 305 || w.id === 304) ? w.hex.slice(0, 4) : w.hex }));
const save = (file, list) => { mkdirSync('tests/fixtures/vb6/world', { recursive: true }); writeFileSync(`tests/fixtures/vb6/world/${file}.jsonl`, list.map(r => JSON.stringify(r)).join('\n') + '\n'); console.log(file, list.map(r => `${r.dir}:${r.id}`).join(' ')); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// 1. Weather toggles, recorded by the GM itself (the server sends them to everybody, the GM included).
const gm = await launch({ email, password, port });
await gm.say('/TELEP YO 1 58 43'); await wait(2000);
const mark = gm.wire.length;
await gm.say('/LLUVIA'); await wait(1500); await gm.say('/LLUVIA'); await wait(1500);
await gm.say('/NIEVE'); await wait(1500); await gm.say('/NIEVE'); await wait(1500);
const weather = gm.wire.slice(mark);
console.log('weather ids', [...new Set(weather.filter(w => w.dir === 's2c').map(w => w.id))]);
save('weather-toggles', rows(weather, w => w.dir === 'c2s' || [59, 122].includes(w.id)));

// 2. PlayWaveStep (188) is NOT recorded: Modulo_UsUaRiOs sends it only when the walker is NOT a GM (EsGM) and is invisible/hidden, to observers that are not GMs
//    either and farther than DISTANCIA_ENVIO_DATOS. That needs two non-GM characters on different accounts; Aotest is a GM. PlayMIDI (54) is never written by the server.
await gm.close();
