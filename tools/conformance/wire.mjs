// Wire helpers shared by the recorder and the scenario helpers (separate module: scenarios are imported while the recorder runs).
export const REDACT = new Set([304, 305]);
export const bodyHex = (id, payload) => Buffer.concat([Buffer.from([id & 255, (id >> 8) & 255]), payload]).toString('hex');
export const clientNames = { 73: 'LoginExistingChar', 75: 'Talk', 78: 'Walk', 79: 'RequestPositionUpdate', 7: 'ModifySkills', 8: 'Train', 46: 'TrainList', 47: 'Rest', 48: 'Meditate', 52: 'RequestStats', 85: 'RequestAtributes', 86: 'RequestSkills', 87: 'RequestMiniStats', 258: 'Quest', 259: 'QuestAccept', 260: 'QuestListRequest', 261: 'QuestDetailsRequest', 262: 'QuestAbandon', 95: 'LeftClick', 96: 'DoubleClick', 304: 'CreateAccount', 305: 'LoginAccount' };
const varint = n => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return o; };
export const str = s => { const b = [...Buffer.from(s)]; return [...varint(b.length), ...b]; };
export const i32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return [...b]; };
export const frame = (id, body = []) => { const l = body.length + 2; return Buffer.from([l & 255, l >> 8, id & 255, id >> 8, ...body]); };
