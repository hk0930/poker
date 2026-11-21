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
  await page.addInitScript(() => { window.__autoDialog = true; }); // アプリ内ダイアログは自動で OK
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

test('CPU対戦: レイズを押すと最小レイズ額が入った状態で開く', async () => {
  const page = await startCpuGame({ cpu: 1 });
  for (let i = 0; i < 100; i++) { if ((await snap(page)).ap) break; await page.clock.runFor(250); }
  const s = await snap(page);
  assert.ok(s.btns.includes('ab-raise'));
  await page.click('#brow .ab-raise');
  const shown = +(await page.textContent('#bet-display')).trim();
  assert.ok(shown >= 20, '最小レイズ額（BB 10 の2倍以上）が入っている: ' + shown);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('レイズの規則: 最小額は「今のベット＋直前のレイズ幅」、足りないオールインは順番を戻さない', async () => {
  const page = await newPage();
  const R = (st, t) => page.evaluate(([a, b]) => window.__poker.testRaise(a, b), [st, t]);
  // BB 10 に対して 15 は小さすぎるので最小の 20 になる
  let r = await R({ curBet: 10, lastRaise: 10, acts: [1, 2], bet: 0, chips: 500 }, 15);
  assert.equal(r.curBet, 20); assert.equal(r.lastRaise, 10); assert.deepEqual(r.acts, [9], 'フルレイズは全員に順番が戻る');
  // 50 にレイズされた後（レイズ幅 40）の最小は 90
  r = await R({ curBet: 50, lastRaise: 40, acts: [1], bet: 10, chips: 500 }, 60);
  assert.equal(r.curBet, 90); assert.equal(r.lastRaise, 40);
  // 手持ちが足りない（70 まで）オールインはレイズ幅を変えず、行動済みの人に順番を戻さない
  r = await R({ curBet: 50, lastRaise: 40, acts: [1, 2], bet: 0, chips: 70 }, 200);
  assert.equal(r.curBet, 70); assert.equal(r.lastRaise, 40); assert.equal(r.allIn, true);
  assert.deepEqual(r.acts, [1, 2], '足りないオールインでは順番を戻さない');
  // 大きいレイズはレイズ幅が更新される
  r = await R({ curBet: 50, lastRaise: 40, acts: [1], bet: 0, chips: 500 }, 200);
  assert.equal(r.curBet, 200); assert.equal(r.lastRaise, 150); assert.equal(r.chips, 300);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('CPU対戦の決着: 最終順位が出て、もう一度は新しい設定のチップで始まる', async () => {
  const page = await startCpuGame({ cpu: 1, chips: 500 });
  await playHandCpu(page, 'fold');
  // CPU を脱落させて決着させる
  await page.evaluate(() => { const c = window.__poker.players[1]; c.chips = 0; c.eliminated = true; c.active = false; });
  await page.click('#mnext');
  for (let i = 0; i < 20; i++) { if ((await snap(page)).title === 'ゲーム終了') break; await page.clock.runFor(250); }
  const s = await snap(page);
  assert.equal(s.title, 'ゲーム終了');
  assert.ok(await page.isVisible('#mcards .rk-list'), '最終順位が出る');
  assert.ok(await page.isVisible('#mnext-lobby'), 'ロビーへ戻るも選べる');
  // ロビーの設定を変えてから「もう一度」
  await page.evaluate(() => { document.getElementById('off-chips').value = '1000'; });
  await page.click('#mnext');
  await page.clock.runFor(500);
  const after = await page.evaluate(() => ({ init: window.__poker.initialChips, total: window.__poker.totalChips(), hand: window.__poker.handNo, mover: document.getElementById('mover').classList.contains('show') }));
  assert.equal(after.init, 1000, '前のゲームのチップ額を持ち越さない');
  assert.equal(after.total, 2000);
  assert.equal(after.hand, 1);
  assert.equal(after.mover, false);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// ─── 効果音・BGM・ランキング（CPU対戦） ───

const soundState = (page) => page.evaluate(() => ({
  sfx: window.__poker.sfxOn, bgm: window.__poker.bgmOn, playing: window.__poker.bgmPlaying,
  gSfx: document.getElementById('g-sound-btn').getAttribute('aria-pressed'),
  ccSfx: document.getElementById('cc-sound-btn').getAttribute('aria-pressed'),
  gBgm: document.getElementById('g-bgm-btn').getAttribute('aria-pressed'),
  ccBgm: document.getElementById('cc-bgm-btn').getAttribute('aria-pressed'),
  lsSfx: localStorage.getItem('cc_sound'), lsBgm: localStorage.getItem('poker_bgm'),
}));

test('効果音とBGM: ボタンで切り替わり、端末に記憶され、チップ計算のボタンとも揃う', async () => {
  const page = await startCpuGame({ cpu: 1 });
  let s = await soundState(page);
  assert.equal(s.sfx, true);
  assert.equal(s.bgm, false, 'テストでは BGM は既定でオフ');
  assert.equal(s.playing, false);

  await page.click('#g-bgm-btn');
  s = await soundState(page);
  assert.equal(s.bgm, true);
  assert.equal(s.playing, true, 'ゲーム画面で BGM が流れる');
  assert.equal(s.gBgm, 'true'); assert.equal(s.ccBgm, 'true');
  assert.equal(s.lsBgm, '1');

  await page.click('#g-sound-btn');
  s = await soundState(page);
  assert.equal(s.sfx, false);
  assert.equal(s.gSfx, 'false'); assert.equal(s.ccSfx, 'false');
  assert.equal(s.lsSfx, '0');

  // 音を鳴らしたまま1ハンド進めてもエラーにならない
  await page.click('#g-sound-btn');
  await playHandCpu(page, 'call');
  assert.deepEqual(page.errors, []);

  // ロビーでは BGM を止める
  await page.evaluate(() => window._pokerGoLobby());
  assert.equal((await soundState(page)).playing, false);

  // 再読み込みしても設定が残る
  await page.reload();
  s = await soundState(page);
  assert.equal(s.bgm, true); assert.equal(s.sfx, true);
  assert.equal(s.playing, false, 'ロビーでは流さない');
  await page.context().close();
});

test('BGMをオフにすると止まる', async () => {
  const page = await startCpuGame({ cpu: 1 });
  await page.click('#g-bgm-btn');
  assert.equal((await soundState(page)).playing, true);
  await page.clock.runFor(3000);
  await page.click('#g-bgm-btn');
  const s = await soundState(page);
  assert.equal(s.playing, false); assert.equal(s.lsBgm, '0');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

const rankingView = (page) => page.evaluate(() => {
  const ov = document.getElementById('g-ranking');
  if (!ov) return null;
  return {
    rows: [...ov.querySelectorAll('.rk-row')].map((r) => ({
      name: r.querySelector('.rk-name').firstChild.textContent, me: r.classList.contains('me'),
    })),
    stats: [...ov.querySelectorAll('.rk-stats b')].map((b) => b.textContent),
    sub: ov.querySelector('.rk-sub').textContent,
  };
});

test('CPU対戦のランキング: 全員が収支順に並び、自分の順位がわかる', async () => {
  const page = await startCpuGame({ cpu: 2 });
  await playHandCpu(page, 'fold');
  await page.click('#mnext-rank'); // 結果画面から開く
  const v = await rankingView(page);
  assert.ok(v, 'ランキングが開く');
  assert.equal(v.rows.length, 3);
  assert.equal(v.rows.filter((r) => r.me).length, 1);
  assert.equal(v.rows.find((r) => r.me).name, 'わたし');
  assert.match(v.sub, /HAND 1/);

  const rows = await page.evaluate(() => window.__poker.rankingRows());
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].net >= rows[i].net, '収支の順に並ぶ');
  // ハンドが終わった時点では、全員の収支の合計は 0（チップは移動しただけ）
  assert.equal(rows.reduce((t, r) => t + r.net, 0), 0);
  assert.equal(rows.reduce((t, r) => t + r.buyin, 0), 1500);
  const myRank = rows.findIndex((r) => r.isMe) + 1;
  assert.match(v.stats[0], new RegExp('^' + myRank + ' / 3'));

  await page.click('#g-rank-close');
  assert.equal(await rankingView(page), null, '閉じられる');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('CPU対戦のランキング: ハンドの途中でも賭けているチップを持ち点に数える', async () => {
  const page = await startCpuGame({ cpu: 1 });
  for (let i = 0; i < 100; i++) { // 自分の最初の手番まで進める
    if ((await snap(page)).ap) break;
    await page.clock.runFor(250);
  }
  const s = await snap(page);
  assert.ok(s.ap);
  await page.click('#g-rank-btn');
  assert.ok(await rankingView(page));
  const rows = await page.evaluate(() => window.__poker.rankingRows());
  const stackSum = rows.reduce((t, r) => t + r.stack, 0);
  assert.ok(stackSum <= 1000 && stackSum >= 1000 - s.pot, 'ポットに入った分を二重に数えない');
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

// ホストが行ったショーダウンの配分を、アプリとは別に書いた参照実装と突き合わせる
const ref = require('./showdown-ref');
async function checkShowdowns(host) {
  const log = await host.evaluate(() => window.__poker.sdLog);
  for (const e of log) {
    if (!e.after) continue;
    const exp = ref.expectedPayouts(e.before);
    e.before.players.forEach((p, i) => {
      const got = e.after.players[i].chips - p.chips;
      assert.ok(Math.abs(got - exp.pay[p.idx]) <= exp.odd, `${p.name}: 受け取り ${got}、正しくは ${exp.pay[p.idx]}`);
    });
  }
  return log.filter((e) => e.after).length;
}

async function closeRoom(room) {
  await checkShowdowns(room.host);
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
  assert.equal(await checkShowdowns(room.host), 1, 'オールインのショーダウンを参照実装と照合');
  await closeRoom(room);
});

test('CPU対戦: 小さい画面(390x600)でもスクロールせず、自分の手札と操作ボタンが見えている', async () => {
  const page = await startCpuGame({ cpu: 5 });
  await page.setViewportSize({ width: 390, height: 600 });
  for (let i = 0; i < 300 && !(await snap(page)).ap; i++) await page.clock.runFor(250);
  const r = await page.evaluate(() => {
    const me = document.querySelector('#seats .seat.me').getBoundingClientRect();
    const ap = document.getElementById('ap').getBoundingClientRect();
    const btn = document.querySelector('#brow .ab').getBoundingClientRect();
    return { scroll: document.scrollingElement.scrollHeight - innerHeight, meBottom: me.bottom, apTop: ap.top, btnBottom: btn.bottom };
  });
  assert.ok(r.scroll <= 0, '縦スクロールが出ています');
  assert.ok(r.btnBottom <= 600, '操作ボタンが画面外です');
  assert.ok(r.meBottom <= r.apTop + 1, '自分の席が操作パネルに隠れています ' + JSON.stringify(r));
  // レイズは2段階
  if ((await snap(page)).btns.includes('ab-raise')) {
    await page.click('#brow .ab-raise');
    assert.ok(await page.evaluate(() => document.getElementById('ap').classList.contains('raising')));
    assert.ok((await snap(page)).ap, '1回目では送信されない');
  }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('CPU対戦: 自分の手札がテーブルや他の席・操作パネルと重ならない（2〜6人、390x600 / 390x844）', async () => {
  for (const H of [600, 844]) {
    for (const cpu of [1, 3, 5]) {
      const page = await startCpuGame({ cpu });
      await page.setViewportSize({ width: 390, height: H });
      for (let i = 0; i < 300 && !(await snap(page)).ap; i++) await page.clock.runFor(250);
      const r = await page.evaluate(() => {
        const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        const hit = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        const me = box(document.querySelector('#seats .seat.me'));
        const others = [...document.querySelectorAll('#seats .seat:not(.me)')].map(box);
        return {
          felt: hit(me, box(document.querySelector('.mtable .felt'))),
          seats: others.some((o) => hit(me, o)),
          ap: hit(me, box(document.getElementById('ap'))),
          pot: hit(me, box(document.getElementById('pot'))),
        };
      });
      assert.deepEqual(r, { felt: false, seats: false, ap: false, pot: false }, `高さ${H}・CPU${cpu}人`);
      await page.context().close();
    }
  }
});
