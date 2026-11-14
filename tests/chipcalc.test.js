// チップ計算モード（1台で操作）のE2Eテスト
// 実行: node --test tests/
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

async function setup(opts) {
  const page = await h.openApp();
  await h.startOffline(page, opts);
  return page;
}

async function finish(page) {
  assert.deepEqual(page.errors, [], 'JSエラーが発生しました');
  assert.ok(await h.chipsConserved(page), 'チップ総量が合いません');
  await page.context().close();
}

// ─── 基本の進行 ───

test('ヘッズアップ: SBがフォールドするとBBがポットを獲得', async () => {
  const page = await setup({ players: 2 });
  let s = await h.state(page);
  assert.equal(s.curIdx, 0, 'ヘッズアップのプリフロップはSB(ディーラー)から');
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  s = await h.state(page);
  assert.equal(s.players[0].chips, 495);
  assert.equal(s.players[1].chips, 505);
  await finish(page);
});

test('3人: 全員コール/チェックでリバーまで進みショーダウンで勝者に配分', async () => {
  const page = await setup({ players: 3 });
  // プリフロップ: UTG(=ディーラー)コール, SBコール, BBチェック
  await h.act(page, 'call');
  await h.act(page, 'call');
  await h.act(page, 'check');
  for (let phase = 1; phase <= 3; phase++) {
    await h.nextPhase(page);
    const s = await h.state(page);
    assert.equal(s.phase, phase);
    for (let i = 0; i < 3; i++) await h.act(page, 'check');
  }
  await h.award(page, [2]);
  const s = await h.state(page);
  assert.equal(s.players[2].chips, 520);
  assert.equal(s.players[0].chips, 490);
  await finish(page);
});

test('次のハンドでディーラーが回り、ブラインドも移動する', async () => {
  const page = await setup({ players: 3 });
  await h.act(page, 'fold');
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  await h.nextHand(page);
  const s = await h.state(page);
  assert.equal(s.roundNum, 2);
  assert.equal(s.dealerIdx, 1);
  assert.equal(s._sbIdx, 2);
  assert.equal(s._bbIdx, 0);
  await finish(page);
});

test('BBオプション: 全員リンプでもBBにチェック/レイズの機会がある', async () => {
  const page = await setup({ players: 3 });
  await h.act(page, 'call');
  await h.act(page, 'call');
  const s = await h.state(page);
  assert.equal(s.curIdx, s._bbIdx, 'BBの手番になる');
  assert.ok(await h.visible(page, '.cc-act-btn[data-act="check"]'));
  assert.ok(!(await h.visible(page, '#cc-next-phase')), 'まだフェーズ移行ボタンは出ない');
  await finish(page);
});

test('最小レイズ未満のレイズは拒否される', async () => {
  const page = await setup({ players: 2 });
  await h.raiseTo(page, 15); // 最小は20
  assert.ok(page.dialogs.some((d) => d.message.includes('最小レイズ')));
  const s = await h.state(page);
  assert.equal(s.curIdx, 0, '手番は変わらない');
  assert.equal(s.pot, 15);
  await finish(page);
});

test('レイズ後は他プレイヤーに再アクションが回る', async () => {
  const page = await setup({ players: 3 });
  await h.act(page, 'call');
  await h.act(page, 'call');
  await h.raiseTo(page, 40); // BBがレイズ
  let s = await h.state(page);
  assert.equal(s.curBet, 40);
  assert.equal(s.curIdx, 0);
  await h.act(page, 'call');
  await h.act(page, 'fold');
  await h.nextPhase(page);
  s = await h.state(page);
  assert.equal(s.phase, 1);
  assert.equal(s.pot, 90);
  await finish(page);
});

// ─── オールイン ───

test('ヘッズアップ: オールイン後、相手はフォールドを選べる', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  assert.ok(await h.visible(page, '.cc-act-btn[data-act="fold"]'), 'FOLDボタンが表示される');
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  const s = await h.state(page);
  assert.equal(s.players[0].chips, 510);
  assert.equal(s.players[1].chips, 490);
  await finish(page);
});

test('ヘッズアップ: オールインにコールすると勝者選択へ進む', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  await h.act(page, 'call');
  await h.award(page, [1]);
  const s = await h.state(page);
  assert.equal(s.players[1].chips, 1000);
  assert.equal(s.players[0].chips, 0);
  await finish(page);
});

test('3人: 1人オールイン後も残り2人は通常どおりアクションできる', async () => {
  const page = await setup({ players: 3 });
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  let s = await h.state(page);
  assert.equal(s.curIdx, 1);
  assert.ok(await h.visible(page, '.cc-act-btn[data-act="fold"]'));
  await h.act(page, 'fold');
  s = await h.state(page);
  assert.equal(s.curIdx, 2);
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  s = await h.state(page);
  assert.equal(s.players[0].chips, 515);
  await finish(page);
});

test('サイドポット: スタックが違う3人のオールインで正しく分配される', async () => {
  const page = await setup({ players: 3 });
  // 1ハンド目はすぐ終わらせて、スタックを調整
  await h.act(page, 'fold');
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  await page.evaluate(() => {
    const p = window.__cc.state.players;
    p[0].chips = 100; p[1].chips = 300; p[2].chips = 600;
    p.forEach((x) => { x.startChips = x.chips; });
  });
  await h.nextHand(page); // ディーラー=1, SB=2, BB=0, 先頭=1
  for (let i = 0; i < 3; i++) {
    const s = await h.state(page);
    if (!s.roundActive) break;
    await h.act(page, 'allin');
    await h.waitOverlayGone(page);
    if (await h.visible(page, '#cc-showdown')) break;
    const s2 = await h.state(page);
    if (s2.curIdx >= 0 && !s2.players[s2.curIdx].allIn && s2.players[s2.curIdx].bet >= s2.curBet) break;
  }
  // 残り1人(P2)がコールしてショーダウン
  if (!(await h.visible(page, '#cc-showdown'))) await h.act(page, 'call');
  await page.waitForSelector('#cc-showdown', { state: 'visible' });
  const pots = await page.$$eval('.cc-pot-block', (els) => els.length);
  assert.equal(pots, 2, 'メイン+サイドの2ポット（コールされない超過分は返却）');
  // メイン(300)はP0、サイド(400)はP1が勝つ
  await page.check('.cc-winner-cb[data-pot="0"][data-idx="0"]');
  await page.check('.cc-winner-cb[data-pot="1"][data-idx="1"]');
  await page.click('#cc-award-btn');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  const s = await h.state(page);
  assert.equal(s.players[0].chips, 300);
  assert.equal(s.players[1].chips, 400);
  assert.equal(s.players[2].chips, 300);
  await finish(page);
});

// ─── リバイ ───

test('チップ0のプレイヤーにリバイ確認が出て、確定までNEXT HANDは押せない', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  await h.act(page, 'call');
  await h.award(page, [1]);
  assert.ok(await h.visible(page, '#cc-rebuy-panel'));
  assert.ok(await page.isDisabled('#cc-next-round'));
  await page.click('.cc-rebuy-btn[data-idx="0"][data-action="rebuy"]');
  assert.ok(!(await page.isDisabled('#cc-next-round')));
  let s = await h.state(page);
  assert.equal(s.players[0].chips, 500);
  assert.equal(s.players[0].rebuyCount, 1);
  await h.nextHand(page);
  s = await h.state(page);
  assert.ok(s.roundActive);
  await finish(page);
});

test('脱落を選ぶと2人ゲームは終了して精算サマリーが出る', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  await h.act(page, 'call');
  await h.award(page, [1]);
  await page.click('.cc-rebuy-btn[data-idx="0"][data-action="out"]');
  await h.nextHand(page);
  await page.waitForSelector('#cc-summary', { state: 'visible' });
  await finish(page);
});

// ─── UNDO ───

test('UNDO: 1手戻すとチップ・手番・ポットが元に戻る', async () => {
  const page = await setup({ players: 3 });
  const before = await h.state(page);
  await h.act(page, 'call');
  assert.ok(await h.visible(page, '#cc-undo-btn'));
  await h.undo(page);
  const s = await h.state(page);
  assert.equal(s.curIdx, before.curIdx);
  assert.equal(s.pot, before.pot);
  assert.deepEqual(s.players.map((p) => p.chips), before.players.map((p) => p.chips));
  assert.ok(await h.visible(page, '.cc-act-btn[data-act="call"]'), 'アクションパネルが再表示される');
  assert.ok(!(await h.visible(page, '#cc-undo-btn')), '履歴が空ならUNDOボタンは隠れる');
  await finish(page);
});

test('UNDO: 複数回連続で戻せる', async () => {
  const page = await setup({ players: 3 });
  const before = await h.state(page);
  await h.act(page, 'call');
  await h.act(page, 'call');
  await h.raiseTo(page, 30);
  await h.undo(page);
  await h.undo(page);
  await h.undo(page);
  const s = await h.state(page);
  assert.equal(s.curIdx, before.curIdx);
  assert.equal(s.curBet, before.curBet);
  assert.deepEqual(s.players.map((p) => p.chips), before.players.map((p) => p.chips));
  await finish(page);
});

test('UNDO: フォールドを取り消せる', async () => {
  const page = await setup({ players: 3 });
  await h.act(page, 'fold');
  await h.undo(page);
  const s = await h.state(page);
  assert.equal(s.players[0].folded, false);
  assert.equal(s.curIdx, 0);
  await finish(page);
});

test('UNDO: 最後のフォールドで決着した後でも取り消してハンドを再開できる', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  await h.undo(page);
  assert.ok(!(await h.visible(page, '#cc-result')), '結果パネルが閉じる');
  const s = await h.state(page);
  assert.ok(s.roundActive);
  assert.equal(s.pot, 15);
  assert.ok(await h.visible(page, '.cc-act-btn[data-act="fold"]'));
  await finish(page);
});

test('UNDO: フェーズ移行を取り消すと前のフェーズに戻る', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'call');
  await h.act(page, 'check');
  await h.nextPhase(page);
  assert.equal((await h.state(page)).phase, 1);
  await h.undo(page);
  const s = await h.state(page);
  assert.equal(s.phase, 0);
  assert.ok(await h.visible(page, '#cc-next-phase'), 'フェーズ移行ボタンが再表示される');
  await finish(page);
});

test('UNDO: オールイン後（演出終了後）に取り消せる', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  await h.undo(page);
  const s = await h.state(page);
  assert.equal(s.players[0].allIn, false);
  assert.equal(s.players[0].chips, 495);
  assert.equal(s.curIdx, 0);
  await finish(page);
});

test('オールイン演出中は画面が覆われて誤操作できない', async () => {
  const page = await setup({ players: 3 });
  await h.act(page, 'allin');
  await page.waitForTimeout(300);
  const blocked = await page.evaluate(() => {
    const btn = document.getElementById('cc-undo-btn');
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top !== btn;
  });
  assert.ok(blocked, '演出中はUNDOボタンが押せない');
  await h.waitOverlayGone(page);
  await finish(page);
});

test('UNDO: ショーダウン（勝者選択）から取り消せる', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  await h.act(page, 'call');
  await page.waitForSelector('#cc-showdown', { state: 'visible' });
  await h.undo(page);
  assert.ok(!(await h.visible(page, '#cc-showdown')));
  const s = await h.state(page);
  assert.equal(s.curIdx, 1);
  assert.ok(await h.visible(page, '.cc-act-btn[data-act="fold"]'));
  await finish(page);
});

test('UNDO: 次のハンドに進むと履歴はリセットされる', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  await h.nextHand(page);
  assert.equal(await h.historyLen(page), 0);
  assert.ok(!(await h.visible(page, '#cc-undo-btn')));
  await finish(page);
});

// ─── 画面 ───

test('スマホ幅で横スクロールが出ない', async () => {
  const page = await setup({ players: 8 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `横に ${overflow}px はみ出しています`);
  await finish(page);
});

test('表示: フォールドしたシートにFOLDが1回だけ出る', async () => {
  const page = await setup({ players: 3 });
  await h.act(page, 'fold');
  const text = await page.$$eval('#cc-seats .seat', (els) => els[0].innerText);
  assert.equal((text.match(/FOLD/g) || []).length, 1, text);
  await finish(page);
});

test('表示: ハンド決着後はBETやストリート額が残らない', async () => {
  const page = await setup({ players: 2 });
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  const seats = await page.$eval('#cc-seats', (el) => el.innerText);
  assert.ok(!seats.includes('BET'), seats);
  assert.equal((await page.textContent('#cc-street-bets')).trim(), '');
  await finish(page);
});

test('表示: カード選択で13枚がスマホ幅に収まる', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, cardMode: true });
  await h.passDevice(page);
  const ok = await page.evaluate(() => {
    const ace = document.querySelector('.cc-pick-card[data-r="A"][data-s="♠"]');
    return ace.getBoundingClientRect().right <= window.innerWidth;
  });
  assert.ok(ok, 'Aの列が画面からはみ出しています');
  await page.context().close();
});

test('スリープ防止: ゲーム中は有効、ロビーに戻ると解除', async () => {
  const page = await setup({ players: 2 });
  assert.equal(await page.evaluate(() => window.__cc.noSleepWanted), true);
  await page.click('#cc-btn-lobby');
  await page.waitForSelector('#screen-lobby.active');
  assert.equal(await page.evaluate(() => window.__cc.noSleepWanted), false);
  await page.context().close();
});

test('効果音: ボタンでオン/オフでき、リロード後も記憶される', async () => {
  const page = await setup({ players: 2 });
  assert.equal(await page.getAttribute('#cc-sound-btn', 'aria-pressed'), 'true');
  await page.click('#cc-sound-btn');
  assert.equal(await page.getAttribute('#cc-sound-btn', 'aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => window.__cc.soundOn), false);
  await h.act(page, 'call'); // 音なしでもエラーにならない
  await page.reload();
  assert.equal(await page.evaluate(() => window.__cc.soundOn), false);
  assert.equal(await page.getAttribute('#cc-sound-btn', 'aria-pressed'), 'false');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('精算: 結果をLINEなどに貼れるテキストでコピーできる', async () => {
  const page = await setup({ players: 3, names: ['たろう', 'はなこ', 'けん'] });
  await h.act(page, 'fold');
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  await page.click('#cc-end-game');
  await page.waitForSelector('#cc-summary', { state: 'visible' });
  const text = await page.evaluate(() => window.__cc.state._summaryText);
  assert.match(text, /1ハンド/);
  assert.match(text, /けん {2}500 → 505（\+5）/);
  assert.match(text, /はなこ → けん {2}5/);
  assert.ok(text.indexOf('けん') < text.indexOf('たろう'), '勝った順に並ぶ');
  await page.click('#cc-summary-copy');
  await page.waitForFunction(() => document.getElementById('cc-summary-copied').textContent !== '');
  assert.equal(await page.textContent('#cc-summary-copied'), 'コピーしました。LINEなどに貼り付けできます');
  await finish(page);
});

// 先頭のプレイヤーがフォールドして1ハンドを終わらせ、次のハンドへ
async function quickHand(page) {
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  await h.nextHand(page);
}

test('ブラインド上昇: 5ハンドごとに上がり、残りハンド数が表示される', async () => {
  const page = await setup({ players: 2, blindUp: 'hands:5' });
  assert.equal(await page.textContent('#cc-blind-info'), 'LV1 ・ 5 / 10 ・ 次まで5ハンド');
  for (let i = 0; i < 4; i++) await quickHand(page);
  let s = await h.state(page);
  assert.equal(s.roundNum, 5);
  assert.equal(s.bbAmt, 10);
  assert.equal(await page.textContent('#cc-blind-info'), 'LV1 ・ 5 / 10 ・ 次まで1ハンド');
  await quickHand(page);
  s = await h.state(page);
  assert.equal(s.roundNum, 6);
  assert.equal(s.sbAmt, 10);
  assert.equal(s.bbAmt, 20);
  assert.equal(s.pot, 30, '上がったブラインドが徴収される');
  assert.equal(await page.textContent('#cc-blind-info'), 'LV2 ・ 10 / 20 ・ 次まで5ハンド');
  assert.match(await page.textContent('#cc-notice'), /10 \/ 20 に上がりました/);
  await finish(page);
});

test('ブラインド上昇: 時間制は経過後の次のハンドから上がる', async () => {
  const page = await setup({ players: 2, blindUp: 'time:10' });
  assert.match(await page.textContent('#cc-blind-info'), /^LV1 ・ 5 \/ 10 ・ 次まで(10:00|9:5\d)$/);
  await page.evaluate(() => window.__cc.shiftClock(10 * 60000 + 1000));
  await page.waitForFunction(() => document.getElementById('cc-blind-info').textContent.includes('次のハンドで上昇'));
  assert.equal((await h.state(page)).bbAmt, 10, 'ハンドの途中では変わらない');
  await quickHand(page);
  const s = await h.state(page);
  assert.equal(s.bbAmt, 20);
  assert.match(await page.textContent('#cc-blind-info'), /^LV2 ・ 10 \/ 20 ・ 次まで/);
  await finish(page);
});

test('ブラインド上昇: なしの時は現在のブラインドだけ表示', async () => {
  const page = await setup({ players: 2 });
  assert.equal(await page.textContent('#cc-blind-info'), 'BLINDS 5 / 10');
  await quickHand(page);
  assert.equal((await h.state(page)).bbAmt, 10);
  await finish(page);
});

test('ブラインド上昇: 中断して再開してもレベルが続く', async () => {
  const page = await setup({ players: 2, blindUp: 'hands:5' });
  for (let i = 0; i < 5; i++) await quickHand(page);
  await page.reload();
  await page.click('#cc-resume-btn');
  const s = await h.state(page);
  assert.equal(s.bbAmt, 20);
  assert.equal(await page.textContent('#cc-blind-info'), 'LV2 ・ 10 / 20 ・ 次まで5ハンド');
  await finish(page);
});

test('表示: ブラインド表示がプレイヤー席に隠れない（2〜8人）', async () => {
  for (const n of [2, 3, 5, 8]) {
    const page = await setup({ players: n, blindUp: 'hands:5' });
    const hidden = await page.evaluate(() => {
      const el = document.getElementById('cc-blind-info');
      const r = el.getBoundingClientRect();
      const pts = [0.2, 0.5, 0.8].map((f) => document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2));
      return pts.some((t) => t !== el);
    });
    assert.ok(!hidden, n + '人でブラインド表示が隠れています');
    await page.context().close();
  }
});

test('遊び方: ロビーから開けて、役10種と進め方を切り替えられる', async () => {
  const page = await h.openApp();
  await page.click('#btn-guide');
  await page.waitForSelector('#guide', { state: 'visible' });
  assert.equal(await page.locator('#guide-hands .guide-hand').count(), 10);
  assert.match(await page.textContent('#guide-hands'), /ロイヤルフラッシュ[\s\S]*ハイカード/);
  await page.click('.guide-tab[data-t="flow"]');
  assert.ok(await h.visible(page, '#guide-flow'));
  assert.match(await page.textContent('#guide-flow'), /フォールド[\s\S]*オールイン/);
  await page.click('#guide-close');
  assert.equal(await page.locator('#guide').count(), 0);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('表示: ハンド決着後は勝者の席が強調され、次のハンドで消える', async () => {
  const page = await setup({ players: 3 });
  await h.act(page, 'fold');
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  const cls = await page.$$eval('#cc-seats .seat', (els) => els.map((e) => e.classList.contains('winner')));
  assert.deepEqual(cls, [false, false, true]);
  await h.nextHand(page);
  assert.equal(await page.locator('#cc-seats .seat.winner').count(), 0);
  await finish(page);
});

test('表示: 小さい画面(390x600)でもゲーム画面がスクロールせず、操作ボタンが見えている', async () => {
  for (const n of [2, 6, 8]) {
    const page = await h.openApp();
    await page.setViewportSize({ width: 390, height: 600 });
    await h.startOffline(page, { players: n });
    const r = await page.evaluate(() => {
      const se = document.scrollingElement;
      const btn = document.querySelector('.cc-act-btn[data-act="fold"]').getBoundingClientRect();
      const seats = [...document.querySelectorAll('#cc-seats .seat')].map((e) => e.getBoundingClientRect());
      const dockTop = document.getElementById('cc-turn-info').getBoundingClientRect().top;
      return {
        scroll: se.scrollHeight - window.innerHeight,
        btnBottom: btn.bottom,
        seatMaxBottom: Math.max(...seats.map((s) => s.bottom)),
        seatMinTop: Math.min(...seats.map((s) => s.top)),
        dockTop,
      };
    });
    assert.ok(r.scroll <= 0, n + '人: 縦スクロールが出ています');
    assert.ok(r.btnBottom <= 600, n + '人: 操作ボタンが画面外です');
    assert.ok(r.seatMaxBottom <= r.dockTop + 1, n + '人: 席が操作パネルに隠れています ' + JSON.stringify(r));
    assert.ok(r.seatMinTop >= 0, n + '人: 席が画面上にはみ出しています');
    await page.context().close();
  }
});

test('レイズ: RAISEを押すと入力欄が開き、もう一度押すと確定する', async () => {
  const page = await setup({ players: 2 });
  assert.ok(!(await h.visible(page, '.cc-chip-btn[data-v="25"]')), '最初は入力欄が閉じている');
  await page.click('.cc-act-btn[data-act="raise"]');
  assert.ok(await h.visible(page, '.cc-chip-btn[data-v="25"]'));
  assert.equal((await h.state(page)).curIdx, 0, '1回目では手番は進まない');
  await page.click('.cc-chip-btn[data-v="25"]');
  await page.click('.cc-chip-btn[data-v="5"]');
  await page.click('.cc-act-btn[data-act="raise"]');
  const s = await h.state(page);
  assert.equal(s.curBet, 30);
  assert.equal(s.curIdx, 1);
  assert.ok(!(await h.visible(page, '.cc-chip-btn[data-v="25"]')), '次の人では閉じている');
  // ✕で閉じられる
  await page.click('.cc-act-btn[data-act="raise"]');
  await page.click('#cc-ap .raise-close');
  assert.ok(!(await h.visible(page, '.cc-chip-btn[data-v="25"]')));
  await finish(page);
});
