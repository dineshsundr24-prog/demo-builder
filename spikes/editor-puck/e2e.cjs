const { chromium } = require('playwright');
const out = '/tmp/claude-0/-home-user/ce3f49ac-27a7-5b3d-aed4-cd19a2af0304/scratchpad/';
const res = {};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:5199/'); await p.waitForTimeout(2500);
  const f = p.frameLocator('iframe');
  // 1. Round trip without edits: trigger no change, compare initial vs converted
  res.roundTripBeforeEdit = await p.evaluate(() => { return (window).__screen ? 'changed-on-load' : 'no-onChange-yet'; });
  // 2. Select nested Stat inside Card and edit value
  await f.getByText('AED 48,750.00').click(); await p.waitForTimeout(400);
  const panel = p.locator('#bal_text_value:visible');
  res.nestedSelectFieldsVisible = await panel.count();
  if (res.nestedSelectFieldsVisible) { await panel.first().fill('AED 52,000.00'); await p.waitForTimeout(500); }
  res.editPropagated = await p.evaluate(() => JSON.stringify((window).__screen || {}).includes('AED 52,000.00'));
  res.canvasUpdated = await f.getByText('AED 52,000.00').count();
  // 3. Drag "Button" from palette into the Card slot (below the stat)
  const src = p.locator('text=Button').last(); const target = f.getByText('AED 52,000.00');
  const sb = await src.boundingBox(); const ifr = await p.locator('iframe').boundingBox(); const tb = await target.boundingBox();
  await p.mouse.move(sb.x + 20, sb.y + 10); await p.mouse.down();
  for (let i = 1; i <= 25; i++) { await p.mouse.move(sb.x + 20 + ((tb.x + 30 - sb.x - 20) * i) / 25, sb.y + 10 + ((tb.y + tb.height + 4 - sb.y - 10) * i) / 25); await p.waitForTimeout(20); }
  await p.waitForTimeout(300); await p.mouse.up(); await p.waitForTimeout(800);
  const scr = await p.evaluate(() => (window).__screen);
  const card = scr?.children?.find(c => c.type === 'Card');
  res.dragIntoNestedSlot = card ? card.children.map(c => c.type).join(',') : 'no-card';
  res.topLevelAfterDrag = scr?.children?.map(c => c.type).join(',');
  await p.screenshot({ path: out + 'puck-2.png' });
  // 4. Undo
  await p.keyboard.press('Control+z'); await p.waitForTimeout(600);
  const afterUndo = await p.evaluate(() => (window).__screen);
  res.undoRestoresCard = afterUndo?.children?.find(c => c.type === 'Card')?.children.map(c => c.type).join(',');
  // 5. ID shape of the inserted component
  res.insertedIds = JSON.stringify(scr).match(/"id":"Button[^"]*"/g);
  // 6. Mobile viewport toggle
  await p.locator('button[title*="Phone"], button[aria-label*="Phone"]').first().click().catch(() => res.viewportBtn = 'not found');
  await p.waitForTimeout(600); res.iframeWidth = (await p.locator('iframe').boundingBox())?.width;
  await p.screenshot({ path: out + 'puck-3.png' });
  // 7. Render parity page
  await p.goto('http://localhost:5199/?mode=render'); await p.waitForTimeout(800);
  res.renderHasBalance = await p.getByText('AED 48,750.00').count();
  res.renderCardTitle = await p.locator('[data-testid=card] h3').allInnerTexts();
  res.pageErrors = errs;
  console.log(JSON.stringify(res, null, 1)); await b.close();
})();
