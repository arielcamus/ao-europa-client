// AGPL-3.0-or-later. Dev tool: a frame-aware TCP proxy between the bridge and a classic server that can INJECT extra server
// packets into the client's stream (rain, snow, fog, time of day, light, particles, projectiles...) for visual checks of
// weather and effects the real server only sends at random. Nothing is sent to the server; every other byte passes untouched.
//
//   node tools/fx-inject-proxy.mjs [--listen 7791] [--target 127.0.0.1:7667] [--control 7792]
//   curl -X POST localhost:7792/packet -d '{"id":59,"raining":true}'      # any server packet the codecs know, as JSON
//   curl -X POST localhost:7792/mapchange -d '{"map":354,"x":50,"y":50}'  # client-only warp: ChangeMap + the player's own CharacterCreate
//                                                                          # (the server still believes the player is on the old map; do not walk)
//
// Point the bridge at --listen (AO_TCP_PORT=7791). Bound to 127.0.0.1 only.
import { createServer as createTcp, createConnection } from 'node:net';
import { createServer as createHttp } from 'node:http';
import { FrameDecoder, encodeServerFrame } from '../packages/protocol/dist/index.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const listen = Number(arg('listen', 7791)), control = Number(arg('control', 7792));
const [targetHost, targetPort] = arg('target', '127.0.0.1:7667').split(':');
const clients = new Set();

createTcp(client => {
  const upstream = createConnection({ host: targetHost, port: Number(targetPort) });
  const decoder = new FrameDecoder();
  const entry = { client, queue: [], self: undefined, creates: new Map() };
  clients.add(entry);
  client.setNoDelay(true); upstream.setNoDelay(true);
  client.on('data', chunk => upstream.write(chunk));
  upstream.on('data', chunk => {
    // Forward whole frames only, so an injected frame never lands inside a server frame.
    for (const body of decoder.push(chunk)) {
      // Remember who the player is (UserCharIndexInServer = 47) and its CharacterCreate (42), for /mapchange.
      const id = body[0] + body[1] * 256;
      if (id === 47) entry.self = body[2] + body[3] * 256;
      if (id === 42) entry.creates.set(body[2] + body[3] * 256, Buffer.from(body)); // CharacterCreate may precede the 47
      const frame = Buffer.alloc(body.length + 2); frame.writeUInt16LE(body.length, 0); Buffer.from(body).copy(frame, 2);
      client.write(frame);
      while (entry.queue.length) client.write(entry.queue.shift());
    }
  });
  const close = () => { clients.delete(entry); client.destroy(); upstream.destroy(); };
  client.on('close', close); upstream.on('close', close); client.on('error', close); upstream.on('error', close);
}).listen(listen, '127.0.0.1', () => console.log(`proxy 127.0.0.1:${listen} -> ${targetHost}:${targetPort}, control 127.0.0.1:${control}`));

createHttp((request, response) => {
  if (request.method !== 'POST' || !['/packet', '/mapchange'].includes(request.url)) { response.writeHead(404).end(); return; }
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    try {
      if (request.url === '/mapchange') {
        const { map, x, y } = JSON.parse(body);
        for (const entry of clients) {
          const own = entry.creates.get(entry.self);
          if (!own) continue;
          const create = Buffer.from(own); create[11] = x; create[12] = y; // CharacterCreate: x, y follow charIndex, body, head, heading
          const frames = [Buffer.from(encodeServerFrame({ id: 30, map, resourceMap: map }))];
          const framed = Buffer.alloc(create.length + 2); framed.writeUInt16LE(create.length, 0); create.copy(framed, 2);
          for (const f of [...frames, framed]) entry.client.write(f);
        }
        response.writeHead(200).end('ok\n');
        return;
      }
      // "self" in any field is replaced by the player's character index, per client.
      const frameFor = entry => Buffer.from(encodeServerFrame(JSON.parse(body, (_key, value) => value === 'self' ? entry.self : value)));
      // Queue for the next frame boundary, and flush now when the upstream is quiet.
      for (const entry of clients) { const frame = frameFor(entry); entry.queue.push(frame); if (!entry.client.destroyed) { while (entry.queue.length) entry.client.write(entry.queue.shift()); } }
      response.writeHead(200).end(`sent to ${clients.size} client(s)\n`);
    } catch (error) { response.writeHead(400).end(String(error)); }
  });
}).listen(control, '127.0.0.1');
