// Second browser test: FSM editing by mouse, library blocks, IEC gates, testbench export through Icarus.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const out = process.argv[2] || '/tmp/shots';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const answers = ['blinker'];
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (answers.shift() || d.defaultValue()) : undefined));
  await page.goto('file://' + path.resolve(__dirname, '../dist/graphical-verilog.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // New FSM
  await page.click('[data-tab=fsm]');
  await page.click('[data-act=new]');
  await page.fill('#askInput', 'blinker'); await page.press('#askInput', 'Enter');
  const c = await (await page.$('#fsmCanvas')).boundingBox();
  await page.mouse.dblclick(c.x + 450, c.y + 220);
  // shift-drag from IDLE (200,200 world, view offset 40,20) to the new state
  const idle = { x: c.x + 240, y: c.y + 220 };
  const s1 = { x: c.x + 450, y: c.y + 220 };
  const sdrag = async (a, b) => { await page.keyboard.down('Shift'); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Shift'); };
  await sdrag(idle, s1);
  await page.fill('#right [data-t=cond]', 'go');
  await page.press('#right [data-t=cond]', 'Tab');
  await sdrag(s1, idle);
  await page.fill('#right [data-t=cond]', '!go');
  await page.fill('#right [data-t=actions]', 'busy = 1');
  await page.press('#right [data-t=actions]', 'Tab');
  // self loop on s1 by dragging and releasing on itself
  await page.mouse.click(s1.x, s1.y);
  await page.fill('#right [data-s=outputs]', 'busy = 1;');
  await page.press('#right [data-s=outputs]', 'Tab');
  const f = await page.evaluate(() => JSON.stringify(GV.App.project.fsms.blinker));
  console.log('fsm', f.length, JSON.parse(f).states.length, 'states', JSON.parse(f).transitions.length, 'transitions');
  await page.click('#simToggle');
  await page.click('#simPanel [data-bit=go]');
  await page.click('#simStep');
  console.log('state after go:', await page.evaluate(() => GV.App.sim.fsm.currentName()));
  await page.screenshot({ path: out + '/9-fsm-edit.png' });
  await page.click('#simToggle');
  await page.keyboard.press('Escape');
  // Place in circuit
  await page.click('#right [data-act=place]');
  console.log('fsm block placed:', await page.evaluate(() => GV.App.circ.components.some((x) => x.type === 'fsm' && x.props.fsm === 'blinker')));
  // Expression block -> library
  answers.push('my_mixer');
  await page.locator('.pal', { hasText: /^Expression block$/ }).click();
  await page.click('#right [data-act=tolib]');
  await page.fill('#askInput', 'my_mixer'); await page.press('#askInput', 'Enter');
  console.log('library has my_mixer:', await page.evaluate(() => !!GV.App.project.library.my_mixer));
  // IEC gates
  await page.locator('.pal', { hasText: /^NAND$/ }).click();
  await page.evaluate(() => { GV.App.project.settings.gateStyle = 'iec'; GV.App.changed(); });
  await page.keyboard.press('f');
  await page.screenshot({ path: out + '/10-iec.png' });
  // Sequence detector example: simulate, export testbench, check in Icarus
  await page.evaluate(() => GV.App.load(GV.EXAMPLES['Sequence detector (1011)']()));
  await page.click('#simToggle');
  for (const b of [1, 0, 1, 1, 0, 1, 1, 0, 1]) {
    const cur = await page.evaluate(() => Number(GV.App.sim.inputs.bit_in));
    if (cur !== b) await page.click('#simPanel [data-bit=bit_in]');
    await page.keyboard.press('Space');
  }
  await page.keyboard.press('r');
  await page.keyboard.press('Space');
  await page.click('#fileBtn');
  await page.click('#fileList [data-a=tb]');
  const tb = await page.inputValue('#settingsDlg textarea');
  await page.click('#settingsDlg [data-x]');
  await page.click('#fileBtn');
  await page.click('#fileList [data-a=verilog]');
  const v = await page.inputValue('#settingsDlg textarea');
  await page.screenshot({ path: out + '/11-export.png' });
  const dir = fs.mkdtempSync('/tmp/gvui-');
  fs.writeFileSync(dir + '/d.v', v); fs.writeFileSync(dir + '/tb.v', tb);
  console.log(execSync(`cd ${dir} && iverilog -o s d.v tb.v && vvp -n s`).toString().trim().split('\n').pop());
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})();
