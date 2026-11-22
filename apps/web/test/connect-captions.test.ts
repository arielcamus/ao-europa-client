import { describe, expect, it } from 'vitest';
import { captionsFor } from '../src/ui-captions.js';
import { CAPTIONS } from '../src/ui-captions-data.js';
import { CONNECT_ART, glyphPath } from '../src/connect-captions.js';

describe('captions of the buttons that tools/ui-captions once skipped (sips refused their BMP header)', () => {
  it.each([
    ['es_boton-lanzar-default', 'LANZAR'], ['es_boton-ingresar-over', 'INGRESAR'], ['es_boton-volver-off', 'VOLVER'], ['es_boton-cuenta-default', 'CUENTA'],
    ['es_boton-salir-default', 'SALIR'], ['es_boton-aceptar-default', 'ACEPTAR'], ['es_boton-comprar-default', 'COMPRAR'], ['es_boton-vender-default', 'VENDER'],
    ['es_boton-depositar-default', 'DEPOSITAR'], ['es_boton-retirar-default', 'RETIRAR'], ['es_boton-config-teclas-default', 'CONFIGURAR TECLAS'],
  ])('%s carries %s', (file, text) => { expect(captionsFor(file)?.map(c => c.text)).toContain(text); });
  it('finds a key written with capitals (VentanaPrincipal-hechizos) by any case', () => {
    expect(Object.keys(CAPTIONS)).toContain('VentanaPrincipal-hechizos');
    expect(captionsFor('es_ventanaprincipal-hechizos')?.map(c => c.text)).toContain('LANZAR');
  });
});

describe('connect screens (account, creation)', () => {
  it('lists the baked buttons of both sprites', () => {
    expect(CONNECT_ART[3839]!.captions.map(c => c.text)).toEqual(['CREAR', 'CREATE', 'JUGAR', 'PLAY']);
    expect(CONNECT_ART[3839]!.glyphs!.map(g => g.kind)).toEqual(['back', 'close']);
    expect(CONNECT_ART[727]!.captions.map(c => c.text)).toEqual(['VOLVER', 'CREAR PERSONAJE']);
  });
  it('draws the glyphs inside their box', () => {
    for (const kind of ['back', 'close'] as const) {
      const nums = glyphPath(kind, 10, 20, 12, 12).match(/-?\d+(\.\d+)?/g)!.map(Number);
      for (let i = 0; i < nums.length; i += 2) { expect(nums[i]).toBeGreaterThanOrEqual(10); expect(nums[i]).toBeLessThanOrEqual(22); expect(nums[i + 1]).toBeGreaterThanOrEqual(20); expect(nums[i + 1]).toBeLessThanOrEqual(32); }
    }
  });
});
