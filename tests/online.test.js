// チップ計算モード「各自の端末で操作」のE2Eテスト
// 偽Firebaseでホストと参加者の2画面を同時に動かす
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const { FakeDb } = require('./fakefirebase');
const h = require('./helpers');

const APP = 'file://' + path.resolve(__dirname, '..', 'texas-poker-online.html') + '?test=1';
let browser;
after(async () => { if (browser) await browser.close(); });

async function device(db) {
  if (!browser) browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.dialogs = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', async (d) => { page.dialogs.push(d.message()); await d.accept(); });
  await page.route(/^https?:\/\//, (r) => r.abort());
  await db.attach(page);
  await page.goto(APP);
  await page.click('#btn-mode-chipcalc');
  await page.click('#cc-sub-online');
  return page;
}

// ホストがルームを作り、参加者が入り、ゲームを開始する
async function setupRoom({ guests = 1, cardMode = false, chips } = {}) {
  const db = new FakeDb();
  const host = await device(db);
  await host.fill('#cc-my-name', 'ホスト');
  if (cardMode) await host.check('#cc-ol-card-mode');
  await host.click('#cc-ol-create');
  await host.waitForSelector('#cc-ol-code-disp:not(:empty)');
  const code = (await host.textContent('#cc-ol-code-disp')).trim();
  const others = [];
  for (let i = 0; i < guests; i++) {
    const g = await device(db);
    await g.fill('#cc-my-name', 'ゲスト' + (i + 1));
    await g.click('#cc-ol-join-toggle');
    await g.fill('#cc-ol-join-code', code);
    await g.click('#cc-ol-join-btn');
    await g.waitForSelector('#cc-ol-wait', { state: 'visible' });
    others.push(g);
  }
  await host.waitForFunction((n) => document.querySelectorAll('#cc-ol-plist > div').length === n, guests + 1);
  if (chips) await host.fill('#cc-ol-chips', String(chips));
  await host.click('#cc-ol-start');
  for (const p of [host, ...others]) await p.waitForSelector('#screen-chipcalc.active');
  return { db, host, guests: others, all: [host, ...others] };
}

// 指定の画面の手番になるまで待つ（アクションパネル表示）
const waitMyTurn = (page) =>
  page.waitForFunction(() => {
    const ap = document.getElementById('cc-ap');
    return ap && ap.style.display === 'block';
  }, null, { timeout: 8000 });

const waitSynced = (a, b) =>
  a.waitForFunction(
    (target) => {
      const s = window.__cc.state;
      return s.pot === target.pot && s.curIdx === target.curIdx && s.phase === target.phase;
    },
    { pot: 0, curIdx: 0, phase: 0, ...b },
    { timeout: 8000 },
  );

async function finish(room) {
  for (const p of room.all) {
    assert.deepEqual(p.errors, [], 'JSエラーが発生しました');
    await p.context().close();
  }
}

test('オンライン: ルーム参加→開始で参加者もゲーム画面に入れる', async () => {
  const room = await setupRoom();
  const g = room.guests[0];
  const gs = await h.state(g);
  assert.equal(gs.players.length, 2);
  assert.deepEqual(gs.players.map((p) => p.name), ['ホスト', 'ゲスト1']);
  // ホストの状態が参加者に届いている
  await waitSynced(g, { pot: 15, curIdx: 0, phase: 0 });
  await finish(room);
});

test('オンライン: ルーム作成後に変えた開始チップが参加者にも反映される', async () => {
  const room = await setupRoom({ chips: 1000 });
  const g = room.guests[0];
  await waitSynced(g, { pot: 15, curIdx: 0, phase: 0 });
  const gs = await h.state(g);
  assert.equal(gs.players[0].chips + gs.players[0].bet, 1000);
  assert.equal(gs.players[1].chips + gs.players[1].bet, 1000);
  await finish(room);
});

test('オンライン: 参加者が自分の端末でアクションでき、ホストに反映される', async () => {
  const room = await setupRoom();
  const { host } = room;
  const g = room.guests[0];
  // ヘッズアップ: ホスト(SB)が先にコール → ゲスト(BB)の手番
  await waitMyTurn(host);
  await h.act(host, 'call');
  await waitMyTurn(g);
  assert.ok(await h.visible(g, '.cc-act-btn[data-act="check"]'));
  await h.act(g, 'check');
  await host.waitForSelector('#cc-next-phase', { state: 'visible' });
  const s = await h.state(host);
  assert.equal(s.pot, 20);
  await finish(room);
});

test('オンライン: ホストがオールイン→参加者はフォールドを選べる', async () => {
  const room = await setupRoom();
  const { host } = room;
  const g = room.guests[0];
  await waitMyTurn(host);
  await h.act(host, 'allin');
  await waitMyTurn(g);
  await h.waitOverlayGone(g);
  assert.ok(await h.visible(g, '.cc-act-btn[data-act="fold"]'));
  await h.act(g, 'fold');
  await host.waitForSelector('#cc-result', { state: 'visible' });
  const s = await h.state(host);
  assert.equal(s.players[0].chips, 510);
  await finish(room);
});

test('オンライン: 参加者のアクションをホストがUNDOすると参加者に手番が戻る', async () => {
  const room = await setupRoom();
  const { host } = room;
  const g = room.guests[0];
  await waitMyTurn(host);
  await h.act(host, 'call');
  await waitMyTurn(g);
  await h.raiseTo(g, 40);
  await waitMyTurn(host);
  await h.undo(host);
  await waitMyTurn(g);
  await waitSynced(g, { pot: 20, curIdx: 1, phase: 0 });
  assert.ok(!(await h.visible(g, '#cc-undo-btn')), '参加者にはUNDOボタンが出ない');
  // 参加者はやり直せる
  await h.act(g, 'check');
  await host.waitForSelector('#cc-next-phase', { state: 'visible' });
  await finish(room);
});

test('オンライン: ショーダウン結果が参加者にも表示され、次のハンドへ進める', async () => {
  const room = await setupRoom();
  const { host } = room;
  const g = room.guests[0];
  await waitMyTurn(host);
  await h.act(host, 'call');
  await waitMyTurn(g);
  await h.act(g, 'check');
  for (let i = 0; i < 3; i++) {
    await h.nextPhase(host);
    await waitMyTurn(g); // フロップ以降はBB(ゲスト)から
    await h.act(g, 'check');
    await waitMyTurn(host);
    await h.act(host, 'check');
  }
  await h.award(host, [1]);
  await g.waitForSelector('#cc-result', { state: 'visible' });
  assert.ok((await g.textContent('#cc-result-body')).includes('ゲスト1'));
  await h.nextHand(host);
  await waitSynced(g, { pot: 15, curIdx: 1, phase: 0 });
  await finish(room);
});

test('オンライン(カード入力): 各自がカードを選び、自動判定まで進む', async () => {
  const room = await setupRoom({ cardMode: true });
  const { host } = room;
  const g = room.guests[0];
  await h.pickCards(host, ['A♠', 'A♥']);
  await h.pickCards(g, ['7♣', '2♦']);
  await waitMyTurn(host);
  await h.act(host, 'call');
  await waitMyTurn(g);
  await h.act(g, 'check');
  const boards = [['K♠', '9♦', '4♣'], ['J♥'], ['3♠']];
  for (const b of boards) {
    await h.nextPhase(host);
    await h.pickCards(host, b);
    await waitMyTurn(g);
    await h.act(g, 'check');
    await waitMyTurn(host);
    await h.act(host, 'check');
  }
  await host.waitForSelector('#cc-result', { state: 'visible' });
  await g.waitForSelector('#cc-result', { state: 'visible' });
  const s = await h.state(host);
  assert.equal(s.players[0].chips, 510);
  await finish(room);
});

test('オンライン(3人): 全員の端末で同じ状態が見える', async () => {
  const room = await setupRoom({ guests: 2 });
  const [host, g1, g2] = room.all;
  // 3人: ディーラー=ホスト, SB=ゲスト1, BB=ゲスト2, 先頭=ホスト
  await waitMyTurn(host);
  await h.act(host, 'call');
  await waitMyTurn(g1);
  await h.act(g1, 'call');
  await waitMyTurn(g2);
  await h.act(g2, 'check');
  await host.waitForSelector('#cc-next-phase', { state: 'visible' });
  for (const p of [g1, g2]) await waitSynced(p, { pot: 30, curIdx: (await h.state(host)).curIdx, phase: 0 });
  await finish(room);
});
