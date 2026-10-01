// Touch controls on a phone-sized landscape screen. Needs `npm run dev`.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:5211/';
const OUT = process.env.SHOT_DIR ?? 'e2e/out';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let ok = true;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); ok &&= !!cond; };
const touch = (type, x, y, id = 1) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id }] });
async function drag(x0, y0, dx, dy, ms) {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= 5; i++) await touch('touchMove', x0 + (dx * i) / 5, y0 + (dy * i) / 5);
  await page.waitForTimeout(ms);
  await touch('touchEnd');
}
const tap = async sel => { const b = await page.locator(sel).boundingBox(); await touch('touchStart', b.x + b.width / 2, b.y + b.height / 2, 2); await page.waitForTimeout(80); await touch('touchEnd'); };
const state = () => page.evaluate(() => { const a = window.spinArena.session.arena; return { x: a.mech.x, z: a.mech.z, jumps: a.mech.airReadyAt, top: a.tops[0] && a.tops[0].body.translation(), dash: a.tops[0]?.lastDash }; });
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.spinArena, null, { timeout: 90000 });
  check('touch layout is on', await page.evaluate(() => document.body.classList.contains('touch')));
  await tap('#practice');
  await page.screenshot({ path: `${OUT}/touch-lobby.png` });
  await tap('#start');
  await page.waitForFunction(() => window.spinArena.session.arena?.clock > 0.3, null, { timeout: 30000 });
  const shown = await page.evaluate(() => [...document.querySelectorAll('[data-act]')].filter(b => !b.classList.contains('hidden')).map(b => b.textContent));
  check('mech sees its three ability buttons', shown.join() === 'Boost,Jump,Parry');
  const s0 = await state();
  // Drag right from anywhere on the left half.
  await drag(200, 250, 70, 0, 900);
  const s1 = await state();
  check('dragging on the left half moves the mech right', s1.x > s0.x + 2);
  await tap('[data-act="air"]');
  await page.waitForTimeout(300);
  const s2 = await state();
  check('the Jump button jumps, in the direction of the last move', s2.jumps > 0 && s2.x > s1.x + 1);
  await page.screenshot({ path: `${OUT}/touch-mech.png` });
  // After the jump lands, a tap on the right half (not a button) must not move the mech.
  await page.waitForFunction(() => !window.spinArena.session.arena.view().mech.air, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const before = await state();
  await touch('touchStart', 600, 150); await page.waitForTimeout(400); await touch('touchEnd');
  await page.waitForTimeout(300);
  const after = await state();
  check('a tap on the right half does not move the mech', Math.hypot(after.x - before.x, after.z - before.z) < 0.3);
  // Now as a top against a bot mech.
  await page.evaluate(() => { window.spinArena.session.backToLobby(); });
  await page.waitForSelector('#lobby:not(.hidden)');
  await tap('[data-team="top"]');
  await tap('#botClear');
  await tap('#botMech');
  await tap('#start');
  await page.waitForFunction(() => window.spinArena.session.arena?.clock > 0.3, null, { timeout: 30000 });
  const shownTop = await page.evaluate(() => [...document.querySelectorAll('[data-act]')].filter(b => !b.classList.contains('hidden')).map(b => b.textContent));
  // The host's default ring is Blaze, whose ability is Empower.
  check('a top sees one ability button, named for its ring', shownTop.join() === 'Empower');
  const t0 = await state();
  await drag(200, 250, 0, -70, 700);
  const t1 = await state();
  check('dragging up moves the top toward −Z', t1.top.z < t0.top.z - 1);
  await tap('[data-act="dash"]');
  await page.waitForTimeout(200);
  check('the ability button uses the ability', (await state()).dash === 1);
  await page.screenshot({ path: `${OUT}/touch-top.png` });
} catch (e) { check(`no exception (${e.message.split('\n')[0]})`, false); }
check('no page errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(ok ? 0 : 1);
