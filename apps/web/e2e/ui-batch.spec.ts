import { test, expect } from '@playwright/test';
import { ServerPacketId as S, ItemsServerPacketId as IS, SpellClientPacketId as SC, encodeServerFrame, FrameDecoder, decodeClientPacket } from '@ao/protocol';

// A double click on a spellbook row casts it, exactly like LANZAR (single click only selects); three-digit read-outs are not clipped.
test('spellbook: double click casts the row, single click only selects; 3-digit bars fit', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'pointer flow');
  const casts: number[] = [];
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer(), decoder = new FrameDecoder();
    server.onMessage(m => ws.send(m));
    ws.onMessage(m => {
      for (const body of decoder.push(Uint8Array.from(m as Buffer))) { const packet = decodeClientPacket(body); if (packet.id === SC.CastSpell) casts.push((packet as { slot: number }).slot); }
      server.send(m);
    });
    setTimeout(() => {
      ws.send(Buffer.from(encodeServerFrame({ id: S.UpdateUserStats, maxHp: 1000, hp: 987, shield: 0, maxMana: 999, mana: 999, maxStamina: 180, stamina: 180, gold: 1200, goldPerLevel: 1000, level: 12, nextLevel: 100, experience: 25, characterClass: 1 })));
      ws.send(Buffer.from(encodeServerFrame({ id: IS.UpdateRM, value: 19 })));
    }, 2500);
  });
  await page.goto('/');
  await expect(page.locator('#connect')).toBeEnabled();
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('#stamina-text')).toHaveText('180 / 180');
  await expect(page.locator('#stat-resistance')).toHaveText('+19%');
  // Fits: the text is never wider than its box plus the allowed slack, and the box does not clip it.
  for (const id of ['#hp-text', '#mana-text', '#stamina-text', '#stat-resistance']) {
    const fit = await page.locator(id).evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); const k = document.querySelector('#classic')!.getBoundingClientRect().width / 1024; return { box: node.getBoundingClientRect().width / k, text: range.getBoundingClientRect().width / k, overflow: getComputedStyle(node).overflow }; });
    expect(fit.overflow, id).toBe('visible');
    expect(fit.text, id).toBeLessThanOrEqual(fit.box + 8 + 1);
  }
  await page.getByRole('tab', { name: 'Hechizos', exact: true }).click();
  const row = page.getByRole('option', { name: 'Flecha Mágica', exact: true });
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  expect(casts).toEqual([]);
  await row.dblclick();
  await expect.poll(() => casts).toEqual([2]);
  await expect(page.locator('#ao-logo')).toBeVisible();
});
