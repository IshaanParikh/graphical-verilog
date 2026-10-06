// Browser smoke test with Playwright: loads the built app, edits, simulates, and takes screenshots.
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '/tmp/shots';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined));
  await page.goto('file://' + path.resolve(__dirname, '../dist/graphical-verilog.html'));
  await page.waitForTimeout(400);
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  await page.screenshot({ path: out + '/1-circuit.png' });
  // simulate
  await page.click('#simToggle');
  await page.click('#simPanel [data-bit=en]');
  await page.fill('#simPanel [data-in=a]', '9');
  await page.press('#simPanel [data-in=a]', 'Enter');
  await page.fill('#simPanel [data-in=b]', '0xC');
  await page.press('#simPanel [data-in=b]', 'Enter');
  for (let i = 0; i < 5; i++) await page.click('#simStep');
  await page.click('#simPanel [data-bit=car]');
  for (let i = 0; i < 3; i++) await page.click('#simStep');
  const sum = await page.evaluate(() => String(GV.App.sim.root.outputs.sum));
  const count = await page.evaluate(() => String(GV.App.sim.root.outputs.count));
  console.log('sum', sum, 'count', count);
  await page.screenshot({ path: out + '/2-sim.png' });
  // FSM tab
  await page.click('#simToggle');
  await page.click('[data-tab=fsm]');
  await page.waitForTimeout(100);
  await page.click('#simToggle');
  await page.click('#simPanel [data-bit=car]');
  await page.click('#simStep');
  await page.screenshot({ path: out + '/3-fsm.png' });
  await page.click('#simToggle');
  // Verilog tab
  await page.click('[data-tab=verilog]');
  await page.screenshot({ path: out + '/4-verilog.png' });
  // Build a new circuit by mouse: new circuit, drag input, AND, output, wire them.
  await page.click('[data-tab=circuit]');
  await page.click('[data-act=newCircuit]');
  await page.press('#askInput', 'Enter');
  const canvas = await page.$('#circuitCanvas');
  const box = await canvas.boundingBox();
  const dragPal = async (label, x, y) => {
    const src = page.locator('.pal', { hasText: new RegExp('^' + label + '$') }).first();
    await src.dragTo(page.locator('#circuitCanvas'), { targetPosition: { x, y } });
  };
  await dragPal('Input', 150, 200);
  await dragPal('Input', 150, 300);
  await dragPal('AND', 380, 250);
  await dragPal('Output', 600, 250);
  const n = await page.evaluate(() => GV.App.circ.components.length);
  console.log('components after drag', n);
  const portPos = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const ids = await page.evaluate(() => GV.App.circ.components.map((c) => c.id));
  const wireUp = async (a, b) => {
    const p = await portPos(a), q = await portPos(b);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 }); await page.mouse.move(q.x, q.y, { steps: 4 }); await page.mouse.up();
  };
  await wireUp(`[data-port="${ids[0]}|out|out"]`, `[data-port="${ids[2]}|in|in0"]`);
  await wireUp(`[data-port="${ids[1]}|out|out"]`, `[data-port="${ids[2]}|in|in1"]`);
  await wireUp(`[data-port="${ids[3]}|in|in"]`, `[data-port="${ids[2]}|out|y"]`);
  console.log('wires', await page.evaluate(() => GV.App.circ.wires.length));
  await page.click('#simToggle');
  await page.click('#simPanel [data-bit=a]');
  await page.click('#simPanel [data-bit=b]');
  console.log('and output', await page.evaluate(() => String(GV.App.sim.root.outputs.y)));
  await page.click('#simStep');
  await page.screenshot({ path: out + '/5-new.png' });
  // undo works
  await page.click('#simToggle');
  await page.keyboard.press('Control+z');
  console.log('wires after undo', await page.evaluate(() => GV.App.circ.wires.length));
  // settings dialog + light theme
  await page.click('#settingsBtn');
  await page.selectOption('#settingsDlg select[data-k=theme]', 'light');
  await page.selectOption('#settingsDlg select[data-k=gateStyle]', 'iec');
  await page.screenshot({ path: out + '/6-settings.png' });
  await page.click('#settingsDlg .foot [data-x]');
  await page.click('[data-open=main]');
  await page.keyboard.press('f');
  await page.screenshot({ path: out + '/7-light.png' });
  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: out + '/8-phone.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('horizontal overflow at phone width:', overflow);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})();
