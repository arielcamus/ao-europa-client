import { test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadMap, objects, isWater, walkable } from '../maps.js';
test('scan', () => {
  const out: string[] = [];
  for (let id = 1; id <= 800; id++) { const m = loadMap(id); if (!m) continue;
    out.push(`${id} ${m.name} safe=${m.safe} restrict=${m.restrict} zone=${m.zone} exits=${m.exits.length} npcs=${m.map.npcs.length} objs=${m.map.objects.length}`); }
  const objs = objects(); const extra: string[] = [];
  for (const id of [1, 2, 751, 752, 753, 754, 755, 756, 757, 758, 759]) { const f = loadMap(id)!; const by: Record<string, string[]> = {}; for (const o of f.map.objects) { const t = objs.get(o.objIndex); if ([6, 19, 31, 44].includes(t?.type ?? 0)) (by[t!.type] ??= []).push(`${o.objIndex}@${o.x},${o.y}`); } let water = 0; for (let y = 1; y <= 100; y++) for (let x = 1; x <= 100; x++) if (isWater(f.map, x, y)) water++; extra.push(`map ${id} water=${water} ${JSON.stringify(by)}`); }
  const tp: string[] = [], locked: string[] = [];
  for (let id = 1; id <= 800; id++) { const f = loadMap(id); if (!f) continue; for (const o of f.map.objects) { const t = objs.get(o.objIndex); if (t?.type === 19) tp.push(`${id}:${o.objIndex}@${o.x},${o.y}`); if (t?.type === 6 && t.llave) locked.push(`${id}:${o.objIndex}@${o.x},${o.y} clave ${t.clave}`); } }
  extra.push('TELEPORTS ' + tp.slice(0, 15).join(' ') + ' total ' + tp.length, 'LOCKED ' + locked.slice(0, 12).join(' ') + ' total ' + locked.length);
  const m = loadMap(751)!;
  writeFileSync('/Users/dev/Projects/ao-client-wt/wpd-scan.txt', out.length + '\n' + out.join('\n') + '\n' + extra.join('\n') + '\n751 ' + JSON.stringify(m.exits.slice(0, 8)) + ' trailing ' + m.map.trailingBytes);
});
