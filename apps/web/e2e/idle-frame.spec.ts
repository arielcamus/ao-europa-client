import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// A character that stops walking shows frame 1 of its walk for its heading and holds it (pinned client 619e69d: Char_Render,
// engine.bas 1340-1349, sets Walk(heading).started = 0; Draw_Grh, engine.bas 451-466, then draws Frames(1)). Walking one tile north
// and one back south must end on exactly the pixels the never-moved character had (same tile, same heading South, frame 1).
const selfClip = async (page: Page) => {
  const box = (await page.locator('#viewport canvas').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return { x: Math.round(cx - 48), y: Math.round(cy - 80), width: 96, height: 96 };
};
test('a character that stops holds the first walk frame of its heading', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await page.waitForTimeout(1500);
  const clip = await selfClip(page);
  const start = await page.locator('#position').innerText();
  const before = await page.screenshot({ clip });
  // Held: the same frame a moment later.
  await page.waitForTimeout(400);
  expect((await page.screenshot({ clip })).equals(before)).toBe(true);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#position')).not.toHaveText(start);
  await page.waitForTimeout(600);
  const north = await page.screenshot({ clip });
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#position')).toHaveText(start);
  await page.waitForTimeout(600);
  const after = await page.screenshot({ clip });
  expect(north.equals(before)).toBe(false); // the other heading draws another sprite (and the map under it moved)
  expect(after.equals(before)).toBe(true);
  await page.waitForTimeout(400);
  expect((await page.screenshot({ clip })).equals(after)).toBe(true);
  expect(failures).toEqual([]);
});
