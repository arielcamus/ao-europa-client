/*
 * frmMain experience read-out: UpdateExpBar captions and ChangeExperienceDisplayMode, from the pinned classic client frmMain.frm.
 * Four labels share one spot (exp, lblPorcLvl, lblPorcLvl2, expRemaining); the four small buttons btnTotalExp, btnExp, btnExp2 and
 * btnExpRemaining pick which one shows. The form starts on `exp` (the only one visible at design time). ButtonsExpBar = 1 (the
 * ao20config default) keeps the buttons; 0 would make a click on the label cycle exp <-> lblPorcLvl, and no pinned form writes it.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import { ponerPuntos } from './combat.js';

export type ExpMode = 'total' | 'percent' | 'percent4' | 'remaining';
/** JsonLanguage MENSAJE_NIVEL_MAXIMO and MENSAJE_EXPERIENCIA_RESTANTE (Languages/1.json). */
export const MAX_LEVEL_TEXT = '¡Nivel Máximo!';
export const REMAINING_PREFIX = 'Restante: ';

/** VB6 `Round(x, n) & "%"`: no trailing zeros. */
const percent = (value: number, digits: number) => `${Number(value.toFixed(digits))}%`;

/** Captions of the four labels (frmMain.UpdateExpBar). `needed` is UserStats.PasarNivel; 0 at the maximum level. */
export function expCaptions(exp: number | undefined, needed: number | undefined): Record<ExpMode, string> {
  if (exp === undefined || needed === undefined) return { total: '—', percent: '—', percent4: '—', remaining: '—' };
  if (needed <= 0) return { total: MAX_LEVEL_TEXT, percent: MAX_LEVEL_TEXT, percent4: MAX_LEVEL_TEXT, remaining: MAX_LEVEL_TEXT };
  return {
    total: `${ponerPuntos(exp)}/${ponerPuntos(needed)}`,
    percent: percent(exp * (100 / needed), 2),
    percent4: percent(exp * (100 / needed), 4),
    remaining: REMAINING_PREFIX + ponerPuntos(needed - exp),
  };
}

/** The four buttons, by the control name they carry in the form. */
export const EXP_BUTTONS: readonly { id: string; mode: ExpMode; art: string; tip: string }[] = [
  { id: 'btn-exp-total', mode: 'total', art: 'boton-exptotal', tip: 'Experiencia total' },
  { id: 'btn-exp2', mode: 'percent4', art: 'boton-expcuatrodecimales', tip: 'Porcentaje con cuatro decimales' },
  { id: 'btn-exp', mode: 'percent', art: 'boton-expdosdecimales', tip: 'Porcentaje con dos decimales' },
  { id: 'btn-exp-remaining', mode: 'remaining', art: 'boton-exprestante', tip: 'Experiencia restante' },
];
export const EXP_LABEL_IDS: Record<ExpMode, string> = { total: 'experience-text', percent: 'exp-percent', percent4: 'exp-percent4', remaining: 'exp-remaining' };
