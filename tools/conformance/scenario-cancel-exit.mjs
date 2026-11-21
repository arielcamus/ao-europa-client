// /SALIR (Quit, id 39) followed at once by Esc (CancelarExit, id 247): the server's CancelExit answers LocaleMsg 578 ("/salir cancelado") and the
// character stays in the game. This server disconnects within about a second of Quit, so the cancel must follow in the same instant.
export default async function run(rec) {
  rec.send(39);
  rec.send(247);
  await rec.wait(r => r.dir === 's2c' && (r.id === 141 || r.id === 7), 5000).catch(() => undefined);
  await rec.sleep(2500);
}
