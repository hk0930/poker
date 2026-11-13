// メインのゲーム（CPU対戦・オンライン対戦）のE2Eテスト
// CPU対戦はブラウザの時計を早送りして、CPUの思考時間や演出を待たずに進める
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const { FakeDb } = require('./fakefirebase');

const APP = 'file://' + path.resolve(__dirname, '..', 'texas-poker-online.html') + '?test=1';
let browser;
after(async () => { if (browser) await browser.close(); });

async function newPage({ clock = false, db } = {}) {
  if (!browser) browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/^https?:\/\//, (r) => r.abort());
  if (db) await db.attach(page);
  if (clock) await page.clock.install();
  await page.goto(APP);
  return page;
}

// 画面の状態をまとめて読む
const snap = (page) => page.evaluate(() => {
  const P = window.__poker;
  return {
    ap: document.getElementById('ap').style.display === 'block',
    mover: document.getElementById('mover').classList.contains('show'),
    title: document.getElementById('mtitle').textContent,
    rebuy: !!document.querySelector('#rebuy-btn-wrap button') && document.getElementById('rebuy-btn-wrap').offsetParent !== null,
    btns: [...document.querySelectorAll('#brow .ab')].map((b) => b.className.split(' ')[1]),
    phase: P.phase, pot: P.pot, curIdx: P.curIdx, myIdx: P.myIdx,
    chips: P.players.map((p) => p.chips), total: P.totalChips(),
    sumChips: P.players.reduce((s, p) => s + p.chips, 0),
  };
});

// 自分の手番での行動: 'call'（チェック/コール）・'fold'・'allin'
async function myAction(page, strategy, s) {
  const has = (c) => s.btns.includes(c);
  let cls;
  if (strategy === 'fold') cls = has('ab-check') ? 'ab-check' : 'ab-fold';
  else if (strategy === 'allin') cls = has('ab-allin') ? 'ab-allin' : 'ab-call';
  else cls = has('ab-check') ? 'ab-check' : 'ab-call';
  await page.click('#brow .' + cls);
}

// CPU対戦: 1ハンドを結果モーダルまで進める（時計を早送り）
async function playHandCpu(page, strategy = 'call', maxSteps = 600) {
  for (let i = 0; i < maxSteps; i++) {
    const s = await snap(page);
    if (s.mover) return s;
    if (s.ap) { await myAction(page, strategy, s); continue; }
    await page.clock.runFor(250);
  }
  throw new Error('ハンドが終わりません（進行が止まっている可能性）: ' + JSON.stringify(await snap(page)));
}

// 結果モーダルを閉じて次のハンドへ（リバイ確認が出たらリバイする）
async function nextRoundCpu(page) {
  await page.click('#mnext');
  for (let i = 0; i < 20; i++) {
    await page.clock.runFor(250);
    const s = await snap(page);
    if (s.rebuy) { await page.click('#rebuy-btn-wrap button'); continue; }
    if (!s.mover || s.title !== 'ショーダウン' && s.title !== 'ラウンド終了') return;
  }
}

async function startCpuGame({ cpu = 1, diff = 'normal', chips = 500 } = {}) {
  const page = await newPage({ clock: true });
  await page.click('#btn-mode-offline');
  await page.fill('#off-name', 'わたし');
  await page.fill('#off-chips', String(chips));
  await page.click(`.cpu-cnt-btn[data-n="${cpu}"]`);
  await page.click(`.diff-btn[data-d="${diff}"]`);
  await page.click('#btn-start-offline');
  await page.waitForSelector('#screen-game.active');
  return page;
}

// ─── CPU対戦 ───

test('CPU対戦: チェック/コールで最後まで進み、ショーダウンでチップが合う', async () => {
  const page = await startCpuGame({ cpu: 1 });
  const s = await playHandCpu(page, 'call');
  assert.match(s.title, /ショーダウン|ラウンド終了/);
  assert.equal(s.sumChips, 1000, 'チップ総量が合わない');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('CPU対戦: 自分がフォールドするとCPUが勝ち、次のハンドへ進める', async () => {
  const page = await startCpuGame({ cpu: 1 });
  const s = await playHandCpu(page, 'fold');
  assert.equal(s.sumChips, 1000);
  const dealer = await page.evaluate(() => window.__poker.dealerIdx);
  await nextRoundCpu(page);
  const after = await page.evaluate(() => ({ phase: window.__poker.phase, dealer: window.__poker.dealerIdx }));
  assert.equal(after.phase, 0);
  assert.notEqual(after.dealer, dealer, 'ディーラーが回る');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

for (const diff of ['easy', 'normal', 'hard']) {
  test(`CPU対戦(${diff}・CPU3人): 5ハンド続けても止まらずチップが合う`, async () => {
    const page = await startCpuGame({ cpu: 3, diff });
    let total = 2000;
    for (let hand = 0; hand < 5; hand++) {
      const s = await playHandCpu(page, hand % 2 ? 'fold' : 'call');
      if (s.title === 'ゲーム終了') break;
      assert.equal(s.sumChips, total, `${hand + 1}ハンド目でチップが合わない`);
      await nextRoundCpu(page);
      total = (await snap(page)).total; // リバイがあれば増えるので、次のハンド開始時点の総量を基準にする
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test('CPU対戦: オールインしてもハンドが最後まで進む', async () => {
  const page = await startCpuGame({ cpu: 2 });
  const s = await playHandCpu(page, 'allin');
  assert.equal(s.sumChips, 1500);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// ─── オンライン対戦 ───

async function onlineDevice(db) {
  const page = await newPage({ db });
  await page.click('#btn-mode-online');
  await page.waitForSelector('#panel-online', { state: 'visible' });
  return page;
}

async function setupOnline({ guests = 1, cpu = 0 } = {}) {
  const db = new FakeDb();
  const host = await onlineDevice(db);
  await host.fill('#my-name', 'ホスト');
  await host.fill('#my-chips', '500');
  await host.click('#btn-create');
  await host.waitForSelector('#code-disp:not(:empty)');
  const code = (await host.textContent('#code-disp')).trim();
  if (cpu) await host.click(`.hcpu-btn[data-n="${cpu}"]`);
  const gs = [];
  for (let i = 0; i < guests; i++) {
    const g = await onlineDevice(db);
    await g.fill('#my-name', 'ゲスト' + (i + 1));
    await g.fill('#my-chips', '500');
    await g.fill('#join-code', code);
    await g.click('#btn-join');
    await g.waitForSelector('#btn-ready', { state: 'visible' });
    await g.click('#btn-ready');
    gs.push(g);
  }
  await host.waitForFunction(() => !document.getElementById('btn-start').disabled, null, { timeout: 8000 });
  await host.click('#btn-start');
  for (const p of [host, ...gs]) await p.waitForSelector('#screen-game.active', { timeout: 8000 });
  return { db, host, guests: gs, all: [host, ...gs] };
}

// 全員の画面を見て、手番の人が行動。全員に結果モーダルが出るまで続ける
async function playHandOnline(room, strategy = () => 'call', timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const states = await Promise.all(room.all.map(snap));
    if (states.every((s) => s.mover)) return states;
    const i = states.findIndex((s) => s.ap && !s.mover);
    if (i >= 0) { await myAction(room.all[i], strategy(i), states[i]); await room.host.waitForTimeout(150); continue; }
    await room.host.waitForTimeout(200);
  }
  throw new Error('オンラインのハンドが終わりません: ' + JSON.stringify(await Promise.all(room.all.map(snap))));
}

async function closeRoom(room) {
  for (const p of room.all) { assert.deepEqual(p.errors, []); await p.context().close(); }
}

test('オンライン対戦: 2人で1ハンドを最後まで進め、両方に結果が出る', async () => {
  const room = await setupOnline();
  const states = await playHandOnline(room);
  const hs = await snap(room.host);
  assert.equal(hs.sumChips, 1000, 'ホスト側のチップ総量');
  const gs = states[1];
  assert.deepEqual(gs.chips, hs.chips, '参加者にも同じチップ数が見える');
  await closeRoom(room);
});

test('オンライン対戦: 参加者がフォールドするとホストが勝ち、次のハンドが始まる', async () => {
  const room = await setupOnline();
  await playHandOnline(room, (i) => (i === 1 ? 'fold' : 'call'));
  const hs = await snap(room.host);
  assert.equal(hs.sumChips, 1000);
  for (const p of room.all) await p.click('#mnext');
  await room.guests[0].waitForFunction(() => window.__poker.phase === 0 && !document.getElementById('mover').classList.contains('show'), null, { timeout: 10000 });
  await playHandOnline(room);
  assert.equal((await snap(room.host)).sumChips, 1000);
  await closeRoom(room);
});

test('オンライン対戦: CPU入りでもハンドが最後まで進む', async () => {
  const room = await setupOnline({ cpu: 1 });
  assert.equal((await snap(room.host)).chips.length, 3, '人間2人+CPU1人');
  await playHandOnline(room);
  assert.equal((await snap(room.host)).sumChips, 1500);
  await closeRoom(room);
});

test('オンライン対戦: オールインでもハンドが最後まで進む', async () => {
  const room = await setupOnline();
  await playHandOnline(room, () => 'allin');
  const hs = await snap(room.host);
  assert.equal(hs.sumChips, 1000);
  await closeRoom(room);
});
