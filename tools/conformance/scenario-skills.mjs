// Skills, attributes, statistics, rest and meditation with a level-1 warrior (10 free skill points at login: SendSkills + LevelUp 10).
// AO_SKILLS_STEP: read (default) = the four request packets + /EST + rest + meditate + trainer list without a target;
// spend = ModifySkills with +1 point on skill 24 (Domar, harmless), then RequestSkills to read it back. The spend step changes the
// character for good: points can only be added.
const bytes24 = delta => Array.from({ length: 24 }, (_, i) => delta[i + 1] ?? 0);
export default async function run(rec) {
  const step = process.env.AO_SKILLS_STEP ?? 'read';
  rec.mark = rec.records.length;
  if (step === 'read') {
    rec.send(86); await rec.sleep(800);   // RequestSkills -> SendSkills
    rec.send(85); rec.send(87); await rec.sleep(800);   // RequestAtributes + RequestMiniStats -> Atributes + MiniStats
    rec.send(52); await rec.sleep(1000);  // RequestStats (/EST) -> console lines
    rec.send(47); await rec.sleep(800);   // Rest: no campfire nearby
    rec.send(48); await rec.sleep(800);   // Meditate: a warrior has no mana
    rec.send(46); await rec.sleep(800);   // TrainList with no selected NPC
    return;
  }
  rec.send(7, bytes24({ 24: 1 })); await rec.sleep(800);
  rec.send(86); await rec.sleep(800);
}
