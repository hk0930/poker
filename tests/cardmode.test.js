// チップ計算モード「カード入力で勝者自動判定」のE2Eテスト
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

async function dealHeadsUp(page, p1, p2) {
  await h.passDevice(page);
  await h.pickCards(page, p1);
  await h.passDevice(page);
  await h.pickCards(page, p2);
}

async function finish(page) {
  assert.deepEqual(page.errors, [], 'JSエラーが発生しました');
  assert.ok(await h.chipsConserved(page), 'チップ総量が合いません');
  await page.context().close();
}

test('カードモード: 最後まで進めると強い役のプレイヤーが自動で勝つ', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, cardMode: true });
  await dealHeadsUp(page, ['A♠', 'A♥'], ['7♣', '2♦']);
  await h.act(page, 'call');
  await h.act(page, 'check');
  await h.nextPhase(page);
  await h.pickCards(page, ['K♠', '9♦', '4♣']);
  await h.act(page, 'check');
  await h.act(page, 'check');
  await h.nextPhase(page);
  await h.pickCards(page, ['J♥']);
  await h.act(page, 'check');
  await h.act(page, 'check');
  await h.nextPhase(page);
  await h.pickCards(page, ['3♠']);
  await h.act(page, 'check');
  await h.act(page, 'check');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  const s = await h.state(page);
  assert.equal(s.players[0].chips, 510);
  assert.equal(s.players[1].chips, 490);
  const body = await page.textContent('#cc-result-body');
  assert.ok(body.includes('ワンペア'), '役名が表示される');
  await finish(page);
});

test('カードモード: 同じ役は引き分けでポットを分ける', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, cardMode: true });
  await dealHeadsUp(page, ['2♠', '3♥'], ['2♣', '3♦']);
  await h.act(page, 'call');
  await h.act(page, 'check');
  await h.nextPhase(page);
  await h.pickCards(page, ['A♠', 'K♦', 'Q♣']);
  for (const cards of [['J♥'], ['10♠']]) {
    await h.act(page, 'check');
    await h.act(page, 'check');
    await h.nextPhase(page);
    await h.pickCards(page, cards);
  }
  await h.act(page, 'check');
  await h.act(page, 'check');
  await page.waitForSelector('#cc-result', { state: 'visible' });
  const s = await h.state(page);
  assert.equal(s.players[0].chips, 500);
  assert.equal(s.players[1].chips, 500);
  await finish(page);
});

test('カードモード: 使用済みカードは選べない', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, cardMode: true });
  await h.passDevice(page);
  await h.pickCards(page, ['A♠', 'K♠']);
  await h.passDevice(page);
  await page.click('.cc-pick-card[data-r="A"][data-s="♠"]');
  assert.ok(await page.isDisabled('#cc-picker-confirm'), '使用済みを押しても選択されない');
  await h.pickCards(page, ['Q♠', 'J♠']);
  await finish(page);
});

test('カードモード: プリフロップでオールイン→コールすると残りカード入力後に自動判定', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, cardMode: true });
  await dealHeadsUp(page, ['K♠', 'K♥'], ['Q♣', 'Q♦']);
  await h.act(page, 'allin');
  await h.waitOverlayGone(page);
  await h.act(page, 'call');
  await h.waitOverlayGone(page, 10000);
  await h.pickCards(page, ['2♠', '7♦', '9♣', '4♥', '3♣']);
  await page.waitForSelector('#cc-result', { state: 'visible' });
  const s = await h.state(page);
  assert.equal(s.players[0].chips, 1000);
  assert.equal(s.players[1].chips, 0);
  await finish(page);
});

test('カードモード: コミュニティカード入力後にUNDOするとカードも戻る', async () => {
  const page = await h.openApp();
  await h.startOffline(page, { players: 2, cardMode: true });
  await dealHeadsUp(page, ['A♠', 'A♥'], ['7♣', '2♦']);
  await h.act(page, 'call');
  await h.act(page, 'check');
  await h.nextPhase(page);
  await h.pickCards(page, ['K♠', '9♦', '4♣']);
  await h.undo(page);
  const s = await h.state(page);
  assert.equal(s.phase, 0);
  const comm = await page.evaluate(() => window.__cc.community.length);
  assert.equal(comm, 0);
  const used = await page.evaluate(() => Object.keys(window.__cc.usedCards).length);
  assert.equal(used, 4, '手札4枚だけが使用済み');
  await finish(page);
});
