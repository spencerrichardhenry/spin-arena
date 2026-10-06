// A second top on one keyboard (I J K L + U/O), on a host computer and on a guest computer. Needs `npm run dev` and internet.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:5211/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let ok = true;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); ok &&= !!cond; };
async function open(name) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 720 } })).newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.spinArena, null, { timeout: 90000 });
  await page.fill('#name', name);
  return page;
}
const tops = page => page.evaluate(() => { const s = window.spinArena.session, a = s.arena; return s.lobby.tops.map((id, i) => ({ id, x: a.tops[i].body.translation().x, z: a.tops[i].body.translation().z, dash: a.tops[i].lastDash })); });
try {
  // Host computer: the host is a top, the second keyboard player is a top, a bot plays the mech.
  const host = await open('Mum');
  await host.click('#practice');
  await host.click('#botClear');
  await host.click('[data-team="top"]');
  await host.click('#botMech');
  await host.click('#second');
  const players = await host.evaluate(() => window.spinArena.session.lobby.players.map(p => `${p.name}:${p.team}`));
  check('the second keyboard player joins as a top', players.includes('Mum 2:top') && players.includes('Mum:top'));
  await host.click('#ready');
  await host.click('#start');
  await host.waitForFunction(() => window.spinArena.session.arena?.clock > 0.2, null, { timeout: 20000 });
  const secondId = await host.evaluate(() => window.spinArena.session.secondId);
  const before = await tops(host);
  // Sideways, toward the middle: the spawn points face buildings to the north and south.
  await host.keyboard.down('KeyJ');
  await host.keyboard.down('KeyD');
  await host.waitForTimeout(700);
  await host.keyboard.up('KeyJ');
  await host.keyboard.up('KeyD');
  await host.keyboard.press('KeyU');
  await host.waitForTimeout(200);
  const after = await tops(host);
  const i2 = before.findIndex(t => t.id === secondId), i1 = before.findIndex(t => t.id !== secondId);
  check('J moves the second top toward −X', after[i2].x < before[i2].x - 1);
  check('D moves the first top toward +X at the same time', after[i1].x > before[i1].x + 1);
  check('U dashes the second top only', after[i2].dash === 1 && after[i1].dash === 0);
  // Guest computer: the second player joins over its own connection.
  await host.evaluate(() => window.spinArena.session.backToLobby());
  await host.click('#leave');
  const h = await open('Host');
  await h.click('#create');
  await h.waitForFunction(() => window.spinArena.room.status === 'open', null, { timeout: 30000 });
  const code = await h.evaluate(() => window.spinArena.room.code);
  const g = await open('Kid');
  await g.fill('#code', code);
  await g.click('#join');
  await g.waitForFunction(() => window.spinArena.room.status === 'connected', null, { timeout: 30000 });
  await g.click('#second');
  await h.waitForFunction(() => window.spinArena.session.lobby.players.some(p => p.name === 'Kid 2'), null, { timeout: 30000 });
  check('a guest computer adds a second player over its own connection', true);
  await h.click('#ready'); await g.click('#ready');
  await h.waitForFunction(() => !document.querySelector('#start').disabled, null, { timeout: 30000 });
  await h.click('#start');
  await h.waitForFunction(() => window.spinArena.session.arena?.clock > 0.3, null, { timeout: 20000 });
  const gb = await tops(h);
  await g.bringToFront();
  await g.keyboard.down('KeyL');
  await h.waitForTimeout(900);
  await g.keyboard.up('KeyL');
  const ga = await tops(h);
  const k2 = await h.evaluate(() => window.spinArena.session.lobby.tops.indexOf(window.spinArena.session.lobby.players.find(p => p.name === 'Kid 2').id));
  check('L on the guest keyboard moves the guest\'s second top on the host', ga[k2].x > gb[k2].x + 1);
} catch (e) { check(`no exception (${e.message.split('\n')[0]})`, false); }
check('no page errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(ok ? 0 : 1);
