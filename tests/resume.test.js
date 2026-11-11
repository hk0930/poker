// 1台モードの自動保存と「続きから再開」のテスト
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

const pick = (s) => ({
  phase: s.phase, pot: s.pot, curIdx: s.curIdx, curBet: s.curBet, roundNum: s.roundNum,
  chips: s.players.map((p) => p.chips), folded: s.players.map((p) => p.folded),
});

async function reloadAndResume(page) {
  await page.reload();
  await page.waitForSelector('#cc-resume-banner', { state: 'visible' });
  await page.click('#cc-resume-btn');
  await page.waitForSelector('#screen-chipcalc.active');
}

async function finish(page) {
  assert.deepEqual(page.errors, [], 'JSエラーが発生しました');
  assert.ok(await h.chipsConserved(page), 'チップ総量が合いません');
  await page.context().close();
}

test('再開: ハンドの途中でリロードしても同じ状態から続けられる', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 3, names: ['あ', 'い', 'う'] });
  await h.act(page, 'call');
  await h.raiseTo(page, 30);
  const before = pick(await h.state(page));
  await reloadAndResume(page);
  assert.deepEqual(pick(await h.state(page)), before);
  assert.deepEqual((await h.state(page)).players.map((p) => p.name), ['あ', 'い', 'う']);
  assert.ok(await h.visible(page, '.cc-act-btn[data-act="call"]'), 'アクションパネルが出る');
  // UNDOも引き継がれる
  await h.undo(page);
  assert.equal((await h.state(page)).curIdx, 1);
  await h.act(page, 'call');
  await h.act(page, 'check');
  await h.nextPhase(page);
  assert.equal((await h.state(page)).phase, 1);
  await finish(page);
});

test('再開: ハンド終了後なら結果画面から次のハンドへ進める', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2 });
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  await reloadAndResume(page);
  assert.ok(await h.visible(page, '#cc-result'));
  await h.nextHand(page);
  const s = await h.state(page);
  assert.equal(s.roundNum, 2);
  assert.ok(s.roundActive);
  await finish(page);
});

test('再開: 勝者選択の途中でリロードしても勝者選択から再開', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2 });
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  await h.act(page, 'call');
  await page.waitForSelector('#cc-showdown', { state: 'visible' });
  await reloadAndResume(page);
  await h.award(page, [0]);
  const s = await h.state(page);
  assert.equal(s.players[0].chips, 1000);
  await finish(page);
});

test('再開: リバイ確認の途中でリロードしてもリバイ確認が出る', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2 });
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  await h.act(page, 'call');
  await h.award(page, [1]);
  await reloadAndResume(page);
  assert.ok(await h.visible(page, '#cc-rebuy-panel'));
  assert.ok(await page.isDisabled('#cc-next-round'));
  await page.click('.cc-rebuy-btn[data-idx="0"][data-action="rebuy"]');
  await h.nextHand(page);
  assert.ok((await h.state(page)).roundActive);
  await finish(page);
});

test('再開: ロビーへ中断した後もバナーから再開できる', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2 });
  await h.act(page, 'call');
  await page.click('#cc-btn-lobby');
  await page.waitForSelector('#cc-resume-banner', { state: 'visible' });
  await page.click('#cc-resume-btn');
  const s = await h.state(page);
  assert.equal(s.curIdx, 1);
  assert.ok(await h.visible(page, '.cc-act-btn[data-act="check"]'));
  await finish(page);
});

test('再開: ゲームを終了（精算）すると保存は消える', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2 });
  await h.act(page, 'fold');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  await page.click('#cc-end-game');
  await page.waitForSelector('#cc-summary', { state: 'visible' });
  await page.reload();
  await page.waitForSelector('#screen-lobby.active');
  assert.ok(!(await h.visible(page, '#cc-resume-banner')));
  await page.context().close();
});

test('再開: 破棄を押すとバナーが消え、新しいゲームを始められる', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2 });
  await page.reload();
  await page.waitForSelector('#cc-resume-banner', { state: 'visible' });
  await page.click('#cc-resume-discard');
  assert.ok(!(await h.visible(page, '#cc-resume-banner')));
  await page.reload();
  assert.ok(!(await h.visible(page, '#cc-resume-banner')));
  await h.startOffline(page, { players: 3 });
  assert.equal((await h.state(page)).players.length, 3);
  await page.context().close();
});

test('再開(カード入力): 手札入力の途中なら未入力の人から入力し直す', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, cardMode: true });
  await h.passDevice(page);
  await h.pickCards(page, ['A♠', 'A♥']);
  await reloadAndResume(page);
  // 1人目の手札は残っていて、2人目だけ入力する
  await h.passDevice(page);
  await page.click('.cc-pick-card[data-r="A"][data-s="♠"]');
  assert.ok(await page.isDisabled('#cc-picker-confirm'), '1人目のカードは使用済みのまま');
  await h.pickCards(page, ['7♣', '2♦']);
  await h.act(page, 'call');
  const s = await h.state(page);
  assert.equal(s.players[0].hole.length, 2);
  assert.equal(s.curIdx, 1);
  await finish(page);
});
