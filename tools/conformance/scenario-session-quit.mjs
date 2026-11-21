// /SALIR (Quit, id 39) in a safe city: the server answers with the closing-countdown message and Disconnect (HandleDisconnect -> login screen).
export default async function run(rec) {
  rec.mark = rec.records.length;
  rec.send(39);
  await rec.wait(r => r.dir === 's2c' && r.id === 7, 15000).catch(() => undefined);
  await rec.sleep(500);
}
