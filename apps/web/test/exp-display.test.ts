import { describe, expect, it } from 'vitest';
import { expCaptions, MAX_LEVEL_TEXT } from '../src/exp-display.js';

describe('frmMain UpdateExpBar captions', () => {
  it('formats the four read-outs like the VB6 form', () => {
    expect(expCaptions(1234, 5000)).toEqual({ total: '1.234/5.000', percent: '24.68%', percent4: '24.68%', remaining: 'Restante: 3.766' });
    expect(expCaptions(1, 3)).toMatchObject({ percent: '33.33%', percent4: '33.3333%' });
    expect(expCaptions(50, 100)).toMatchObject({ percent: '50%', percent4: '50%', remaining: 'Restante: 50' });
  });
  it('shows the maximum-level text on all four when nothing is left to gain', () => {
    expect(Object.values(expCaptions(9, 0))).toEqual([MAX_LEVEL_TEXT, MAX_LEVEL_TEXT, MAX_LEVEL_TEXT, MAX_LEVEL_TEXT]);
  });
  it('shows a dash until the server has sent the stats', () => { expect(expCaptions(undefined, 100).total).toBe('—'); });
});
