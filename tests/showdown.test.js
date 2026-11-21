// ショーダウンの勝敗判定・チップ配分のテスト
// アプリとは別に書いた参照実装（showdown-ref.js）と突き合わせる
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const ref = require('./showdown-ref');

const APP = 'file://' + path.resolve(__dirname, '..', 'texas-poker-online.html') + '?test=1';
let browser;
after(async () => { if (browser) await browser.close(); });

async function newPage() {
  if (!browser) browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route(/^https?:\/\//, (r) => r.abort());
  await page.clock.install();
  await page.addInitScript(() => { window.__autoDialog = true; });
  await page.goto(APP);
  return page;
}
const C = (t) => ({ r: t.slice(0, -1), s: t.slice(-1) });

test('参照実装: 役の強さの基本', () => {
  const s = (a) => ref.best7(a.map(C));
  const board = ['Q♠', 'Q♣', 'Q♥', '7♠', 'A♥'];
  assert.ok(ref.cmp(s(['K♣', 'K♥', ...board]), s(['4♣', 'K♠', ...board])) > 0, 'フルハウス > スリーカード');
  assert.ok(ref.cmp(s(['4♣', 'K♠', ...board]), s(['J♣', '4♦', ...board])) > 0, 'キッカー K > J');
  assert.ok(ref.cmp(s(['A♣', '2♦', '3♠', '4♥', '5♣', 'K♦', 'Q♦']), s(['K♣', 'Q♥', 'J♠', '9♥', '8♣', '2♣', '3♦'])) > 0, 'A-5 ストレート > ハイカード');
  assert.equal(ref.cmp(s(['2♣', '3♦', ...board]), s(['2♦', '3♣', ...board])), 0, '同じ強さは引き分け');
});

// 報告のあった場面: リオンが 455 オールインでフルハウス、ソフィア(Q3枚・K)とプレイヤー1(Q3枚・J)とアレックスが上乗せ
const REPORTED = {
  comm: ['Q♠', 'Q♣', 'Q♥', '7♠', 'A♥'],
  players: [
    { name: 'プレイヤー1', stack: 650, bet: 575, hole: ['J♣', '4♦'] },
    { name: 'アレックス', stack: 470, bet: 470, hole: ['5♠', '8♣'] },
    { name: 'ソフィア', stack: 500, bet: 500, hole: ['4♣', 'K♠'] },
    { name: 'リオン', stack: 455, bet: 455, hole: ['K♣', 'K♥'] },
  ],
};

test('報告の場面: メインポットはリオン、サイドポットはソフィア、プレイヤー1は超過分の返却だけ', async () => {
  const page = await newPage();
  const r = await page.evaluate((spec) => window.__poker.testShowdown(spec), REPORTED);
  // リオン: 455×4 = 1820 / ソフィア: (470-455)×3 + (500-470)×2 = 105 / プレイヤー1: 575-500 = 75 の返却のみ
  assert.deepEqual(r.chips, [650 - 575 + 75, 0, 105, 1820]);
  assert.equal(r.main, 'リオン', '見出しの勝者はメインポットの勝者だけ');
  assert.deepEqual(r.side, ['ソフィア'], 'サイドポット 455→470 と 470→500 はどちらもソフィアなので1行にまとめる');
  assert.match(r.body, /サイドポット（105）: ソフィア/);
  assert.deepEqual(r.trophies, ['リオン'], 'トロフィーはメインポットの勝者だけ');
  assert.match(r.body, /フルハウス/);
  assert.match(r.body, /プレイヤー1 の誰もコールしなかった 75 は本人に返却/);
  assert.doesNotMatch(r.body, /プレイヤー1.*の勝利/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

const SCENES = [
  { title: '引き分けはポットを山分け', comm: ['2♠', '7♦', '9♣', 'J♥', 'K♠'], players: [
    { name: 'A', stack: 500, bet: 200, hole: ['A♣', '3♦'] }, { name: 'B', stack: 500, bet: 200, hole: ['A♦', '3♣'] }, { name: 'C', stack: 500, bet: 200, hole: ['Q♣', '4♦'] }] },
  { title: 'ショートスタックが勝つとメインだけ取り、サイドは次に強い人', comm: ['2♠', '7♦', '9♣', 'J♥', 'K♠'], players: [
    { name: 'A', stack: 100, bet: 100, hole: ['K♣', 'K♦'] }, { name: 'B', stack: 500, bet: 400, hole: ['J♣', 'J♦'] }, { name: 'C', stack: 600, bet: 400, hole: ['A♣', 'Q♦'] }] },
  { title: 'フォールドした人の賭け額もポットに入る', comm: ['2♠', '7♦', '9♣', 'J♥', 'K♠'], players: [
    { name: 'A', stack: 500, bet: 300, hole: ['A♣', 'A♦'] }, { name: 'B', stack: 500, bet: 150, hole: ['K♣', 'K♦'], folded: true }, { name: 'C', stack: 300, bet: 300, hole: ['Q♣', 'Q♦'] }] },
  { title: 'キッカーで決まる', comm: ['Q♠', 'Q♣', 'Q♥', '7♠', 'A♥'], players: [
    { name: 'A', stack: 500, bet: 300, hole: ['J♣', '4♦'] }, { name: 'B', stack: 500, bet: 300, hole: ['K♣', '2♦'] }] },
  { title: 'ボードがそのまま一番強い時は全員で山分け', comm: ['10♠', 'J♠', 'Q♠', 'K♠', 'A♠'], players: [
    { name: 'A', stack: 500, bet: 100, hole: ['2♣', '3♦'] }, { name: 'B', stack: 500, bet: 100, hole: ['4♣', '5♦'] }, { name: 'C', stack: 500, bet: 100, hole: ['6♣', '7♦'] }] },
];
for (const sc of SCENES) {
  test('配分: ' + sc.title, async () => {
    const page = await newPage();
    const r = await page.evaluate((spec) => window.__poker.testShowdown(spec), sc);
    const before = { comm: sc.comm.map(C), players: sc.players.map((q, i) => ({ name: q.name, idx: i, active: true, folded: !!q.folded, totalBet: q.bet, hole: q.hole.map(C) })) };
    const exp = ref.expectedPayouts(before);
    sc.players.forEach((q, i) => {
      const got = r.chips[i] - (q.stack - q.bet);
      assert.ok(Math.abs(got - exp.pay[i]) <= exp.odd, `${q.name}: 受け取り ${got}、正しくは ${exp.pay[i]}`);
    });
    assert.equal(r.chips.reduce((a, b) => a + b, 0), sc.players.reduce((a, q) => a + q.stack, 0), 'チップの総量は変わらない');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

// CPU対戦を実際に何ハンドも進め、毎回のショーダウンを参照実装と突き合わせる
test('CPU対戦の実プレイ: すべてのショーダウンの配分が参照実装と一致する', async () => {
  let checked = 0;
  for (const [cpu, chips, diff] of [[5, 500, 'easy'], [3, 300, 'normal'], [4, 1000, 'hard']]) {
    const page = await newPage();
    await page.click('#btn-mode-offline');
    await page.fill('#off-chips', String(chips));
    await page.click(`.cpu-cnt-btn[data-n="${cpu}"]`);
    await page.click(`.diff-btn[data-d="${diff}"]`);
    await page.click('#btn-start-offline');
    for (let hand = 0; hand < 15; hand++) {
      let title = null;
      for (let i = 0; i < 800 && !title; i++) {
        const s = await page.evaluate(() => ({
          ap: document.getElementById('ap').style.display === 'block',
          mover: document.getElementById('mover').classList.contains('show'),
          title: document.getElementById('mtitle').textContent,
          btns: [...document.querySelectorAll('#brow .ab')].map((b) => b.className.split(' ')[1]),
          rebuy: !!document.querySelector('#rebuy-btn-wrap button') && document.getElementById('rebuy-btn-wrap').offsetParent !== null,
        }));
        if (s.rebuy) { await page.click('#rebuy-btn-wrap button'); continue; }
        if (s.mover) { title = s.title; break; }
        if (s.ap) { // サイドポットができやすいようにオールインを多めに
          const r = Math.random();
          const c = r < 0.45 && s.btns.includes('ab-allin') ? 'ab-allin' : r < 0.6 ? (s.btns.includes('ab-check') ? 'ab-check' : 'ab-fold') : (s.btns.includes('ab-check') ? 'ab-check' : 'ab-call');
          await page.click('#brow .' + c);
          continue;
        }
        await page.clock.runFor(250);
      }
      if (!title || title === 'ゲーム終了') break;
      await page.click('#mnext');
      for (let i = 0; i < 12; i++) {
        await page.clock.runFor(250);
        if (await page.evaluate(() => !!document.querySelector('#rebuy-btn-wrap button') && document.getElementById('rebuy-btn-wrap').offsetParent !== null)) await page.click('#rebuy-btn-wrap button');
      }
    }
    const log = await page.evaluate(() => window.__poker.sdLog);
    for (const e of log) {
      if (!e.after) continue;
      checked++;
      const exp = ref.expectedPayouts(e.before);
      let sumGot = 0;
      e.before.players.forEach((p, i) => {
        const got = e.after.players[i].chips - p.chips;
        sumGot += got;
        assert.ok(Math.abs(got - exp.pay[p.idx]) <= exp.odd, `${p.name}: 受け取り ${got}、正しくは ${exp.pay[p.idx]} ${JSON.stringify(exp.pots)}`);
      });
      assert.equal(sumGot, e.before.pot, 'ポットは全額配られる');
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  }
  assert.ok(checked >= 10, 'ショーダウンを十分な回数確かめた: ' + checked);
});
