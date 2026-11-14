// 途中参加・途中退席のテスト（1台モード）
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

async function endHand(page) {
  // 手番の人が順にフォールドしてハンドを終わらせる
  while (!(await h.visible(page, '#cc-result'))) await h.act(page, 'fold');
}
async function openMembers(page) {
  await page.click('#cc-members-btn');
  await page.waitForSelector('#cc-members', { state: 'visible' });
}
async function leave(page, name) {
  const idx = (await h.state(page)).players.findIndex((p) => p.name === name);
  await page.click(`.cc-mem-leave[data-idx="${idx}"]`);
}
async function add(page, name, chips) {
  await page.fill('#cc-mem-name', name);
  if (chips) await page.fill('#cc-mem-chips', String(chips));
  await page.click('#cc-mem-add');
}
const names = async (page) => (await h.state(page)).players.map((p) => p.name);

async function finish(page) {
  assert.deepEqual(page.errors, [], 'JSエラーが発生しました');
  assert.ok(await h.chipsConserved(page), 'チップ総量が合いません（退席者を含む）');
  await page.context().close();
}

test('途中退席: ハンドの間に退席でき、残りの人で続けられる', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 3, names: ['あ', 'い', 'う'] });
  await endHand(page);
  await openMembers(page);
  await leave(page, 'い');
  assert.deepEqual(await names(page), ['あ', 'う']);
  await page.click('#cc-mem-close');
  await h.nextHand(page);
  const s = await h.state(page);
  assert.equal(s.players.length, 2);
  assert.ok(s.roundActive);
  assert.equal(s.leftPlayers[0].name, 'い');
  await finish(page);
});

test('途中退席: 退席した人も精算に「途中退席」として残る', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 3, names: ['あ', 'い', 'う'] });
  await endHand(page); // あ・い がフォールド → う(BB)が5獲得、い(SB)が-5
  await openMembers(page);
  await leave(page, 'い');
  await page.click('#cc-mem-close');
  await page.click('#cc-end-game');
  await page.waitForSelector('#cc-summary', { state: 'visible' });
  const body = await page.textContent('#cc-summary-body');
  assert.match(body, /い\s*途中退席/);
  const text = await page.evaluate(() => window.__cc.state._summaryText);
  assert.match(text, /い {2}500 → 495（-5） 途中退席/);
  assert.match(text, /い → う {2}5/);
  await finish(page);
});

test('途中参加: ハンドの間に新しい人を追加でき、次のハンドから参加する', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, names: ['あ', 'い'] });
  await endHand(page);
  await openMembers(page);
  await add(page, 'う', 300);
  await add(page, 'あ'); // 同じ名前は自動で番号を付ける
  assert.deepEqual(await names(page), ['あ', 'い', 'う', 'あ2']);
  await page.click('#cc-mem-close');
  await h.nextHand(page);
  const s = await h.state(page);
  assert.equal(s.players.length, 4);
  assert.equal(s.players[2].chips + s.players[2].bet, 300);
  await finish(page);
});

test('途中退席→復帰: 持っていたチップのまま戻れる', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 3, names: ['あ', 'い', 'う'] });
  await endHand(page);
  await openMembers(page);
  await leave(page, 'い'); // い は 495 で退席
  await page.click('.cc-mem-back[data-i="0"]');
  const s = await h.state(page);
  const i = s.players.find((p) => p.name === 'い');
  assert.equal(i.chips, 495);
  assert.equal(i.startChips, 500, '買い直しにはならない');
  assert.equal(s.leftPlayers.length, 0);
  await finish(page);
});

test('途中退席: ディーラーが退席したら次の人がディーラーになる', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 4, names: ['あ', 'い', 'う', 'え'] });
  await endHand(page); // ディーラー=あ
  await h.nextHand(page); // ディーラー=い
  await endHand(page);
  await openMembers(page);
  await leave(page, 'い');
  await page.click('#cc-mem-close');
  await h.nextHand(page);
  const s = await h.state(page);
  assert.equal(s.players[s.dealerIdx].name, 'う');
  await finish(page);
});

test('途中退席: 1人だけになったらNEXT HANDで精算へ進む', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, names: ['あ', 'い'] });
  await endHand(page);
  await openMembers(page);
  await leave(page, 'あ');
  assert.match(await page.textContent('#cc-next-round'), /精算へ/);
  await page.click('#cc-mem-close');
  await h.nextHand(page);
  await page.waitForSelector('#cc-summary', { state: 'visible' });
  await finish(page);
});

test('途中参加・退席: 中断して再開しても席の変更が残る', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 3, names: ['あ', 'い', 'う'] });
  await endHand(page);
  await openMembers(page);
  await leave(page, 'う');
  await add(page, 'え');
  await page.reload();
  await page.click('#cc-resume-btn');
  assert.deepEqual(await names(page), ['あ', 'い', 'え']);
  assert.equal((await h.state(page)).leftPlayers[0].name, 'う');
  await finish(page);
});

test('メンバー変更ボタンはハンドの途中には出ない', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2 });
  assert.ok(!(await h.visible(page, '#cc-members-btn')));
  await endHand(page);
  assert.ok(await h.visible(page, '#cc-members-btn'));
  await page.context().close();
});

// ─── 暫定ランキング ───
async function openRanking(page) {
  await page.click('#cc-rank-btn');
  await page.waitForSelector('#cc-ranking', { state: 'visible' });
  return page.$$eval('#cc-ranking .rk-row', (rows) => rows.map((r) => ({
    name: r.querySelector('.rk-name').childNodes[0].textContent,
    net: r.querySelector('.rk-net').textContent,
    detail: r.querySelector('.rk-detail').textContent.replace(/\s/g, ''),
  })));
}

test('暫定ランキング: バイインとリバイを含めた収支で並び、退席者も載る', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 3, names: ['あ', 'い', 'う'] });
  // 1ハンド目: あ がオールイン、い がコール、う はフォールド → い の勝ちにする
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  await h.act(page, 'call');
  await h.act(page, 'fold');
  await h.award(page, [1]);
  await page.click('.cc-rebuy-btn[data-idx="0"][data-action="rebuy"]'); // あ はリバイ
  let rows = await openRanking(page);
  assert.deepEqual(rows.map((r) => r.name), ['い', 'う', 'あ']);
  assert.deepEqual(rows.map((r) => r.net), ['+510', '-10', '-500']);
  assert.equal(rows[2].detail, '持ち点500／投入1000', 'リバイ分も投入額に入る');
  assert.match(await page.textContent('#cc-ranking .rk-stats'), /バイイン合計\s*2000/);
  await page.click('#cc-rank-close');
  // う が途中退席してもランキングに残る
  await page.click('#cc-members-btn');
  await page.click('.cc-mem-leave[data-idx="2"]');
  await page.click('#cc-mem-close');
  rows = await openRanking(page);
  assert.equal(rows.length, 3);
  assert.match(await page.textContent('#cc-ranking'), /う途中退席/);
  await page.click('#cc-rank-close');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('暫定ランキング: ハンドの途中でも賭けているチップを持ち点に含めて表示する', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, names: ['あ', 'い'] });
  await h.act(page, 'call'); // あ 10 / い 10 がポットに入っている
  const rows = await openRanking(page);
  assert.deepEqual(rows.map((r) => r.net), ['±0', '±0']);
  assert.match(await page.textContent('#cc-ranking .rk-foot'), /進行中のハンド/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
