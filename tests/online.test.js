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
async function setupRoom({ guests = 1, cardMode = false, chips, blindUp } = {}) {
  const db = new FakeDb();
  const host = await device(db);
  await host.fill('#cc-my-name', 'ホスト');
  if (cardMode) await host.check('#cc-ol-card-mode');
  if (blindUp) await host.selectOption('#cc-ol-blind-up', blindUp);
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

// ─── ホスト引き継ぎ ───

const conserved = (page) => page.evaluate(() => window.__cc.totalChips() === window.__cc.totalStart());
const takeoverShown = (page, timeout = 6000) =>
  page.waitForSelector('#cc-takeover', { state: 'visible', timeout });

test('引き継ぎ: ホストの端末が落ちたら参加者が引き継いで続けられる', async () => {
  const room = await setupRoom({ guests: 2 });
  const [host, g1, g2] = room.all;
  await waitMyTurn(host);
  await h.act(host, 'call'); // ディーラー(ホスト)がコール → SB(ゲスト1)の手番
  await waitMyTurn(g1);
  await host.context().close(); // ホストの端末が落ちる
  await takeoverShown(g1);
  await takeoverShown(g2);
  await g1.click('#cc-takeover-btn');
  await g1.waitForFunction(() => window.__cc.isHost === true);
  await g2.waitForSelector('#cc-takeover', { state: 'hidden' });
  // 旧ホストはこのハンドをフォールド扱い。ゲスト1の手番から再開
  let s = await h.state(g1);
  assert.equal(s.players[0].folded, true);
  assert.equal(s.curIdx, 1);
  await waitMyTurn(g1);
  await h.act(g1, 'call');
  await waitMyTurn(g2);
  await h.act(g2, 'check');
  await g1.waitForSelector('#cc-next-phase', { state: 'visible' });
  s = await h.state(g1);
  assert.equal(s.pot, 30);
  assert.ok(await conserved(g1));
  // 参加者(ゲスト2)にも新ホストの状態が届く
  await waitSynced(g2, { pot: 30, curIdx: s.curIdx, phase: 0 });
  for (const p of [g1, g2]) assert.deepEqual(p.errors, []);
  await g1.context().close();
  await g2.context().close();
});

test('引き継ぎ: ホストが「ロビーへ」で抜けたらすぐに引き継ぎを案内する', async () => {
  const room = await setupRoom({ guests: 2 });
  const [host, g1, g2] = room.all;
  await waitMyTurn(host);
  await host.click('#cc-btn-lobby');
  await takeoverShown(g1, 1500); // 生存信号の途絶を待たずに出る
  assert.equal(await g1.textContent('#cc-takeover-title'), 'ホストが退出しました');
  await g2.click('#cc-takeover-btn');
  await g2.waitForFunction(() => window.__cc.isHost === true);
  // 旧ホストの手番だったので自動でフォールドされ、次の人(ゲスト1)の手番
  await waitMyTurn(g1);
  await h.act(g1, 'fold');
  await g2.waitForSelector('#cc-result', { state: 'visible' });
  assert.ok(await conserved(g2));
  for (const p of room.all) assert.deepEqual(p.errors, []);
  for (const p of room.all) await p.context().close();
});

test('引き継ぎ: 旧ホストが戻ると参加者になり、次のハンドから参加できる', async () => {
  const room = await setupRoom({ guests: 2 });
  const [host, g1, g2] = room.all;
  await waitMyTurn(host);
  await h.act(host, 'call');
  await waitMyTurn(g1);
  await host.evaluate(() => window.__cc.stopHostBeat()); // スリープ相当
  await takeoverShown(g1);
  await g1.click('#cc-takeover-btn');
  // 旧ホストは自動で参加者に切り替わる
  await host.waitForFunction(() => window.__cc.isHost === false, null, { timeout: 5000 });
  assert.ok(!(await h.visible(host, '#cc-undo-btn')));
  // このハンドを終わらせて次へ
  await waitMyTurn(g1);
  await h.act(g1, 'fold');
  await g1.waitForSelector('#cc-result', { state: 'visible' });
  await h.nextHand(g1);
  // 旧ホストに手番が来るまで進める（フォールド扱いにならないこと）
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    await g1.waitForTimeout(700);
    for (const p of [host, g1, g2]) {
      if (await p.evaluate(() => document.getElementById('cc-ap').style.display === 'block')) {
        if (p === host) { reached = true; break; }
        const s = await h.state(p);
        const me = s.players[s.curIdx];
        await h.act(p, me && me.bet >= s.curBet ? 'check' : 'call');
        break;
      }
    }
  }
  assert.ok(reached, '旧ホストにアクションの番が回ってくる');
  const hs = await h.state(host);
  await h.act(host, hs.players[0].bet >= hs.curBet ? 'check' : 'call');
  await g1.waitForTimeout(500);
  const s = await h.state(g1);
  assert.equal(s.players[0].folded, false);
  assert.ok(await conserved(g1));
  for (const p of room.all) assert.deepEqual(p.errors, []);
  for (const p of room.all) await p.context().close();
});

test('引き継ぎ(カード入力): 引き継いだホストが手札を使って自動判定できる', async () => {
  const room = await setupRoom({ guests: 2, cardMode: true });
  const [host, g1, g2] = room.all;
  await h.pickCards(host, ['2♣', '7♦']);
  await h.pickCards(g1, ['A♠', 'A♥']);
  await h.pickCards(g2, ['K♠', 'K♥']);
  await waitMyTurn(host);
  await h.act(host, 'call');
  await waitMyTurn(g1);
  await host.context().close();
  await takeoverShown(g2);
  await g2.click('#cc-takeover-btn');
  await g2.waitForFunction(() => window.__cc.isHost === true);
  await waitMyTurn(g1);
  await h.act(g1, 'call');
  await waitMyTurn(g2);
  await h.act(g2, 'check');
  for (const b of [['9♣', '5♦', '3♠'], ['J♦'], ['4♣']]) {
    await h.nextPhase(g2);
    await h.pickCards(g2, b);
    await waitMyTurn(g1);
    await h.act(g1, 'check');
    await waitMyTurn(g2);
    await h.act(g2, 'check');
  }
  await g2.waitForSelector('#cc-result', { state: 'visible' });
  const s = await h.state(g2);
  assert.equal(s.players[1].chips, 520, 'AAのゲスト1が勝つ');
  assert.ok(await conserved(g2));
  for (const p of [g1, g2]) assert.deepEqual(p.errors, []);
  await g1.context().close();
  await g2.context().close();
});

test('引き継ぎ: ホストが生きている間は引き継ぎ案内が出ない', async () => {
  const room = await setupRoom();
  const g = room.guests[0];
  await g.waitForTimeout(4000); // 判定時間(2.5秒)より長く待つ
  assert.ok(!(await h.visible(g, '#cc-takeover')));
  await finish(room);
});

test('オンライン: 精算結果のテキストが参加者にも届き、コピーできる', async () => {
  const room = await setupRoom();
  const { host } = room;
  const g = room.guests[0];
  await waitMyTurn(host);
  await h.act(host, 'fold');
  await host.waitForSelector('#cc-result', { state: 'visible' });
  await host.click('#cc-end-game');
  await g.waitForSelector('#cc-summary', { state: 'visible' });
  const text = await g.evaluate(() => window.__cc.state._summaryText);
  assert.match(text, /ホスト → ゲスト1 {2}5/);
  await g.click('#cc-summary-copy');
  await g.waitForFunction(() => document.getElementById('cc-summary-copied').textContent !== '');
  await finish(room);
});

test('オンライン: ブラインド上昇が参加者の画面にも表示され、引き継ぎ後も続く', async () => {
  const room = await setupRoom({ guests: 2, blindUp: 'hands:5' });
  const [host, g1, g2] = room.all;
  await g1.waitForFunction(() => document.getElementById('cc-blind-info').textContent === 'LV1 ・ 5 / 10 ・ 次まで5ハンド');
  // 5ハンド進める（手番の人がフォールドを繰り返す）
  for (let hand = 0; hand < 5; hand++) {
    while (!(await h.visible(host, '#cc-result'))) {
      let acted = false;
      for (const p of room.all) {
        if (await p.evaluate(() => document.getElementById('cc-ap').style.display === 'block')) {
          await h.act(p, 'fold'); acted = true; break;
        }
      }
      if (!acted) await host.waitForTimeout(200);
    }
    await h.nextHand(host);
    await host.waitForTimeout(200);
  }
  await g2.waitForFunction(() => document.getElementById('cc-blind-info').textContent === 'LV2 ・ 10 / 20 ・ 次まで5ハンド');
  // ホストが落ちても、引き継いだ人がレベルを引き継ぐ
  await host.context().close();
  await g1.waitForSelector('#cc-takeover', { state: 'visible', timeout: 6000 });
  await g1.click('#cc-takeover-btn');
  await g1.waitForFunction(() => window.__cc.isHost === true);
  const s = await h.state(g1);
  assert.equal(s.bbAmt, 20);
  assert.equal(s.blindLevel, 1);
  assert.equal(await g1.textContent('#cc-blind-info'), 'LV2 ・ 10 / 20 ・ 次まで5ハンド');
  for (const p of [g1, g2]) { assert.deepEqual(p.errors, []); await p.context().close(); }
});

test('ルーム作成時に、終了・放置された古いルームが削除される', async () => {
  const db = new FakeDb();
  const now = Date.now();
  db.write('ccrooms', {
    OLD111: { status: 'started', createdAt: now - 3 * 86400000, hostBeat: now - 2 * 86400000 },
    END222: { status: 'ended', createdAt: now - 3 * 3600000, hostBeat: now - 2 * 3600000 },
    NEW333: { status: 'started', createdAt: now - 3600000, hostBeat: now - 1000 },
    END444: { status: 'ended', createdAt: now - 600000, hostBeat: now - 60000 },
    LEG555: { status: 'started' },
  });
  const host = await device(db);
  await host.fill('#cc-my-name', 'ホスト');
  await host.click('#cc-ol-create');
  await host.waitForSelector('#cc-ol-code-disp:not(:empty)');
  await host.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 500));
  const left = Object.keys(db.read('ccrooms')).sort();
  const code = (await host.textContent('#cc-ol-code-disp')).trim();
  assert.deepEqual(left, [code, 'END444', 'LEG555', 'NEW333'].sort());
  assert.deepEqual(host.errors, []);
  await host.context().close();
});
