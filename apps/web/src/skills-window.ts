/*
 * Skill window (FrmEstadisticas.frm, "ventanaskills"), statistics window (frmStatistics.frm, "ventanaestadisticas_*") and the
 * trainer's creature list (frmEntrenador.frm), adapted 2026-11-20. Positions are the original VB6 twips / 15 relative to
 * each form; artwork and *-over buttons are read from the local mount. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; no warranty. See NOTICE.
 */
import './skills-window.css';
import { loadInterface } from './interface-assets.js';
import { SkillAllocation, statsView } from './skills.js';
import type { Session } from './session.js';
import { SKILL_NAMES } from './game-text.js';

type Box = readonly [left: number, top: number, width: number, height: number];
interface SkillRow { value: Box; minus: Box; plus: Box }
/** FrmEstadisticas Text1(i) and Command1(2i-2 plus / 2i-1 minus) for skills 1..24 (15 and 25 are hidden in the .frm). */
const SKILL_LAYOUT: Readonly<Record<number, SkillRow>> = {
  1: { value: [187, 151, 18, 14], minus: [155, 149, 22, 20], plus: [215, 149, 22, 20] },
  2: { value: [187, 427, 19, 14], minus: [155, 424, 22, 20], plus: [215, 424, 22, 20] },
  3: { value: [187, 277, 19, 14], minus: [155, 274, 22, 20], plus: [215, 274, 22, 20] },
  4: { value: [187, 251, 19, 14], minus: [155, 249, 22, 20], plus: [215, 249, 22, 20] },
  5: { value: [187, 176, 19, 14], minus: [155, 174, 22, 20], plus: [215, 174, 22, 20] },
  6: { value: [187, 378, 19, 14], minus: [155, 375, 22, 20], plus: [215, 375, 22, 20] },
  7: { value: [397, 375, 19, 14], minus: [364, 374, 22, 20], plus: [424, 374, 22, 20] },
  8: { value: [397, 350, 19, 14], minus: [364, 348, 22, 20], plus: [424, 348, 22, 20] },
  9: { value: [397, 401, 19, 14], minus: [364, 400, 22, 20], plus: [424, 400, 22, 20] },
  10: { value: [187, 303, 19, 14], minus: [155, 300, 22, 20], plus: [215, 300, 22, 20] },
  11: { value: [187, 452, 19, 14], minus: [155, 450, 22, 20], plus: [215, 450, 22, 20] },
  12: { value: [187, 352, 18, 14], minus: [155, 350, 22, 20], plus: [215, 350, 22, 20] },
  13: { value: [187, 327, 19, 14], minus: [155, 325, 22, 20], plus: [215, 325, 22, 20] },
  14: { value: [397, 452, 19, 14], minus: [364, 450, 22, 20], plus: [424, 450, 22, 20] },
  16: { value: [187, 202, 19, 14], minus: [155, 200, 22, 20], plus: [215, 200, 22, 20] },
  17: { value: [397, 151, 19, 14], minus: [364, 149, 22, 20], plus: [424, 149, 22, 20] },
  18: { value: [397, 177, 19, 14], minus: [364, 174, 22, 20], plus: [424, 174, 22, 20] },
  19: { value: [397, 203, 19, 14], minus: [364, 200, 22, 20], plus: [424, 200, 22, 20] },
  20: { value: [397, 254, 19, 14], minus: [364, 251, 22, 20], plus: [424, 251, 22, 20] },
  21: { value: [397, 228, 19, 14], minus: [364, 225, 22, 20], plus: [424, 225, 22, 20] },
  22: { value: [397, 304, 19, 14], minus: [364, 303, 22, 20], plus: [424, 303, 22, 20] },
  23: { value: [397, 280, 19, 14], minus: [364, 277, 22, 20], plus: [424, 277, 22, 20] },
  24: { value: [397, 426, 19, 14], minus: [364, 424, 22, 20], plus: [424, 424, 22, 20] },
};
const AMBER = '#eba40e', RED = 'rgb(255,0,0)';

function node<T extends HTMLElement = HTMLDivElement>(parent: HTMLElement, className: string, box?: Box, tag = 'div'): T {
  const el = document.createElement(tag) as T; el.className = className;
  if (box) { el.style.left = `${box[0]}px`; el.style.top = `${box[1]}px`; el.style.width = `${box[2]}px`; el.style.height = `${box[3]}px`; }
  parent.append(el); return el;
}
function form(parent: HTMLElement, id: string, label: string, size: readonly [number, number], art: string) {
  const root = node(parent, 'sk-form', [Math.floor((1024 - size[0]) / 2), Math.floor((768 - size[1]) / 2), size[0], size[1]]);
  root.id = id; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', label);
  void loadInterface(art).then(url => { root.style.backgroundImage = `url("${url}")`; }).catch(() => {});
  return root;
}
/** An invisible button over the artwork; the `-over` bitmap shows while the pointer is on it (clsGraphicalButton / MouseMove). */
function hotspot(root: HTMLElement, label: string, box: Box, over: string | undefined, action: () => void) {
  const button = node<HTMLButtonElement>(root, 'sk-hotspot', box, 'button'); button.type = 'button'; button.setAttribute('aria-label', label); button.title = label;
  if (over) void loadInterface(over).then(url => {
    button.addEventListener('mouseenter', () => { button.style.backgroundImage = `url("${url}")`; });
    button.addEventListener('mouseleave', () => { button.style.backgroundImage = ''; });
  }).catch(() => {});
  button.addEventListener('click', action);
  return button;
}
/** MsgBox(vbYesNo). */
function ask(root: HTMLElement, text: string, answer: (yes: boolean) => void) {
  root.querySelector('.sk-msgbox')?.remove();
  const box = node(root, 'sk-msgbox'); box.setAttribute('role', 'alertdialog');
  node(box, 'sk-msg-title').textContent = 'Argentum Online';
  node(box, 'sk-msg-text').textContent = text;
  const row = node(box, 'sk-msg-buttons');
  for (const [label, yes] of [['Sí', true], ['No', false]] as const) {
    const button = node<HTMLButtonElement>(row, 'sk-msg-button', undefined, 'button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => { box.remove(); answer(yes); });
  }
  box.querySelector('button')?.focus();
}

export class SkillsWindows {
  private readonly skills: HTMLElement; private readonly stats: HTMLElement; private readonly trainer: HTMLElement;
  private session: Session | undefined;
  private allocation: SkillAllocation | undefined;
  private readonly valueLabels = new Map<number, HTMLElement>();
  private points!: HTMLElement;
  private tab: 'personaje' | 'combate' | 'pesca' = 'personaje';
  private revision = -1;
  private readonly statLabels: Record<string, HTMLElement> = {};
  private readonly attrLabels: HTMLElement[] = [];
  private creatureList!: HTMLElement; private creatureSelected = -1;

  constructor(parent: HTMLElement) {
    // FrmEstadisticas, 473 x 577. Aceptar and Cerrar both offer to save pending changes (MENSAJEBOX_*_SKILLPOINTS).
    this.skills = form(parent, 'skills-window', 'Skills', [473, 577], 'ventanaskills');
    this.points = node(this.skills, 'sk-label', [328, 92, 30, 14]);
    for (const [skill, row] of Object.entries(SKILL_LAYOUT)) {
      const index = Number(skill);
      this.valueLabels.set(index, node(this.skills, 'sk-label sk-value', row.value));
      hotspot(this.skills, `${SKILL_NAMES[index]}: menos`, row.minus, 'boton-sm-flecha-izq-over', () => this.change(index, false));
      hotspot(this.skills, `${SKILL_NAMES[index]}: más`, row.plus, 'boton-sm-flecha-der-over', () => this.change(index, true));
    }
    hotspot(this.skills, 'Aceptar', [171, 526, 132, 28], 'boton-aceptar-over', () => this.closeSkills(true));
    hotspot(this.skills, 'Cerrar', [442, 0, 31, 28], 'boton-cerrar-over', () => this.closeSkills(true));

    // frmStatistics, 359 x 551: three tabs; Label6 / Atri values over the artwork's captions.
    this.stats = form(parent, 'stats-window', 'Estadísticas', [359, 551], 'ventanaestadisticas_personaje');
    const at = (name: string, box: Box) => { this.statLabels[name] = node(this.stats, 'sk-label sk-stat', box); };
    at('class', [136, 195, 200, 13]); at('race', [136, 216, 200, 13]); at('gender', [136, 235, 200, 13]); at('alignment', [136, 254, 200, 13]); at('jail', [136, 275, 200, 13]);
    at('criminals', [136, 254, 100, 13]); at('citizens', [136, 235, 100, 13]); at('npcs', [136, 275, 100, 13]); at('fishing', [270, 159, 60, 16]);
    [335, 355, 376, 396, 416].forEach(top => this.attrLabels.push(node(this.stats, 'sk-label sk-stat', [136, top, 40, 14])));
    hotspot(this.stats, 'Personaje', [17, 78, 36, 33], 'boton-personaje-over', () => this.showTab('personaje'));
    hotspot(this.stats, 'Combate', [54, 78, 36, 33], 'boton-retos-over', () => this.showTab('combate'));
    hotspot(this.stats, 'Pesca', [90, 78, 36, 33], 'boton-pesca-over', () => this.showTab('pesca'));
    hotspot(this.stats, 'Aceptar', [115, 500, 129, 27], 'boton-aceptar-over', () => this.session?.skills.closeStats());
    hotspot(this.stats, 'Cerrar', [328, 0, 31, 25], 'boton-cerrar-over', () => this.session?.skills.closeStats());

    // frmEntrenador, 250 x 247: a plain Windows form, list of creatures, Luchar / Salir.
    this.trainer = node(parent, 'sk-trainer', [387, 260, 250, 247]); this.trainer.id = 'trainer-window'; this.trainer.hidden = true;
    this.trainer.setAttribute('role', 'dialog'); this.trainer.setAttribute('aria-label', 'Seleccione la criatura');
    node(this.trainer, 'sk-trainer-title', [0, 0, 246, 18]).textContent = 'Seleccione la criatura';
    const question = node(this.trainer, 'sk-trainer-question', [8, 26, 230, 16]); question.textContent = '¿Con qué criatura deseas combatir?';
    this.creatureList = node(this.trainer, 'sk-trainer-list', [16, 48, 214, 140]); this.creatureList.setAttribute('role', 'listbox');
    const fight = node<HTMLButtonElement>(this.trainer, 'sk-trainer-button', [32, 204, 114, 26], 'button'); fight.type = 'button'; fight.textContent = 'Luchar';
    const leave = node<HTMLButtonElement>(this.trainer, 'sk-trainer-button', [164, 204, 58, 26], 'button'); leave.type = 'button'; leave.textContent = 'Salir';
    fight.addEventListener('click', () => { this.session?.train(this.creatureSelected + 1); this.session?.skills.closeTrainer(); });
    leave.addEventListener('click', () => this.session?.skills.closeTrainer());
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.closeAll(); }, true);
  }
  get skillsOpen() { return !this.skills.hidden; }
  get statsOpen() { return !this.stats.hidden; }
  get trainerOpen() { return !this.trainer.hidden; }
  closeAll() { this.session?.skills.closeSkills(); this.session?.skills.closeStats(); this.session?.skills.closeTrainer(); this.allocation = undefined; this.skills.hidden = this.stats.hidden = this.trainer.hidden = true; }

  /** Command1_Click: one point more or less, the colour of the changed value, the points left. */
  private change(skill: number, plus: boolean) {
    const a = this.allocation; if (!a) return;
    if (plus ? a.add(skill) : a.remove(skill)) this.drawSkills();
  }
  /** Image1_Click / imgCerrar_Click: with pending changes ask first; Yes sends ModifySkills, No just closes. Escape closes silently. */
  private closeSkills(prompt: boolean) {
    const session = this.session, a = this.allocation; if (!session || !a) return;
    const done = () => { this.allocation = undefined; session.skills.closeSkills(); this.skills.hidden = true; };
    if (prompt && a.changed) {
      ask(this.skills, 'Realizó cambios en sus skillpoints ¿desea guardar antes de salir?', yes => {
        if (yes) {
          session.modifySkills(a.delta);
          session.skills.skills = [...a.values]; session.skills.skillPoints = a.remaining; // UserSkills(i) = value, SkillPoints = Alocados
        }
        done();
      });
    } else done();
  }
  private drawSkills() {
    const a = this.allocation; if (!a) return;
    this.points.textContent = String(a.remaining);
    for (const [skill, label] of this.valueLabels) {
      label.textContent = String(a.values[skill]); label.style.color = a.added[skill]! > 0 ? RED : AMBER;
    }
  }
  private showTab(tab: 'personaje' | 'combate' | 'pesca') {
    this.tab = tab;
    void loadInterface(`ventanaestadisticas_${tab}`).then(url => { this.stats.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    this.drawStats();
  }
  private drawStats() {
    const s = this.session?.skills; if (!s?.attributes || !s.miniStats) return;
    const view = statsView(s.attributes, s.miniStats);
    const show = (name: string, on: boolean, text: string | number) => { const el = this.statLabels[name]!; el.hidden = !on; el.textContent = String(text); };
    const personaje = this.tab === 'personaje';
    show('class', personaje, view.className); show('race', personaje, view.race); show('gender', personaje, view.gender);
    show('alignment', personaje, view.alignment.text); this.statLabels.alignment!.style.color = view.alignment.color;
    show('jail', personaje, view.jail);
    show('criminals', this.tab === 'combate', view.criminalsKilled); show('citizens', this.tab === 'combate', view.citizensKilled); show('npcs', this.tab === 'combate', view.npcsKilled);
    show('fishing', this.tab === 'pesca', view.fishingPoints);
    this.attrLabels.forEach((label, i) => { label.hidden = !personaje; label.textContent = String(view.attributes[i]); });
  }

  update(session: Session | undefined) {
    if (this.session !== session) { this.session = session; this.closeAll(); this.revision = -1; }
    if (!session) return;
    const s = session.skills;
    if (s.skillsOpen && this.skills.hidden) { this.allocation = new SkillAllocation(s.skills, s.skillPoints); this.skills.hidden = false; this.drawSkills(); }
    else if (!s.skillsOpen && !this.skills.hidden) { this.skills.hidden = true; this.allocation = undefined; }
    if (s.statsOpen && this.stats.hidden) { this.stats.hidden = false; this.showTab('personaje'); }
    else if (!s.statsOpen && !this.stats.hidden) this.stats.hidden = true;
    if (s.revision === this.revision) return;
    this.revision = s.revision;
    if (s.statsOpen) this.drawStats();
    if (s.trainerCreatures && this.trainer.hidden) {
      this.creatureSelected = -1; this.creatureList.replaceChildren();
      s.trainerCreatures.forEach((name, index) => {
        const row = node(this.creatureList, 'sk-trainer-row'); row.textContent = name; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
        row.addEventListener('click', () => {
          this.creatureSelected = index;
          this.creatureList.querySelectorAll('.sk-trainer-row').forEach((other, i) => other.setAttribute('aria-selected', String(i === index)));
        });
      });
      this.trainer.hidden = false;
    } else if (!s.trainerCreatures && !this.trainer.hidden) this.trainer.hidden = true;
  }
}
