// PlayMIDI (54) from the real VB6 server. The server only sends it from two GM commands (HanldeForceMIDIToMap, HandleForceMIDIAll);
// record as an Admin (Server.ini [Admines]): /FORCEMIDIMAP 5 (ForceMIDIToMap 152: midiID 5, map 0 -> the GM's own map) and
// /FORCEMIDIMAP 0 (midiID 0 -> the map's music_numberLow). Both reach every player on the map; clients ignore PlayMIDI (HandlePlayMIDI).
export default async function run(rec) {
  for (const midi of [5, 0]) {
    const mark = rec.records.length;
    rec.send(152, [midi, 0, 0]);
    await rec.wait(r => r.id === 54 && rec.records.indexOf(r) >= mark, 5000);
    await rec.sleep(600);
  }
  rec.send(39); await rec.sleep(500); // Quit
}
