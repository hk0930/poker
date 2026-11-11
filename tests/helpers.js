// チップ計算モードのE2Eテスト用ヘルパー
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '..', 'texas-poker-online.html') + '?test=1';

let browser;
async function getBrowser() {
  if (!browser) browser = await chromium.launch();
  return browser;
}
async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
}

// ページを開く。外部通信（Firebase/フォント）は遮断してオフラインで動かす
async function openApp() {
  const b = await getBrowser();
  const context = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', async (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    await d.accept();
  });
  await page.route(/^https?:\/\//, (r) => r.abort());
  await page.goto(APP);
  page.errors = errors;
  page.dialogs = dialogs;
  return page;
}

// 1台モードでゲーム開始
async function startOffline(page, { players = 2, chips = 500, sb = 5, bb = 10, names, cardMode = false, blindUp } = {}) {
  await page.click('#btn-mode-chipcalc');
  await page.click(`.cc-cnt-btn[data-n="${players}"]`);
  if (names) {
    for (let i = 0; i < names.length; i++) await page.fill(`.cc-name-inp[data-i="${i}"]`, names[i]);
  }
  await page.fill('#cc-chips', String(chips));
  await page.fill('#cc-sb', String(sb));
  await page.fill('#cc-bb', String(bb));
  if (cardMode) await page.check('#cc-card-mode');
  if (blindUp) await page.selectOption('#cc-blind-up', blindUp);
  await page.click('#btn-start-chipcalc');
  await page.waitForSelector('#screen-chipcalc.active');
}

const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__cc.state)));
const historyLen = (page) => page.evaluate(() => window.__cc.history.length);
const chipsConserved = (page) =>
  page.evaluate(() => window.__cc.totalChips() === window.__cc.totalStart());

const visible = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && el.offsetParent !== null;
  }, sel);

// 現在の手番プレイヤーのアクションボタンを押す
async function act(page, action) {
  const sel = `.cc-act-btn[data-act="${action}"]`;
  if (!(await visible(page, sel))) throw new Error(`ボタン ${action} が表示されていません`);
  await page.click(sel);
}

// レイズ額をチップボタンで入力してRAISE（額は5の倍数で、100/25/10/5の組み合わせ）
async function raiseTo(page, amount) {
  await page.click('.cc-chip-clr');
  let rest = amount;
  for (const v of [500, 100, 25, 10, 5]) {
    while (rest >= v) {
      await page.click(`.cc-chip-btn[data-v="${v}"]`);
      rest -= v;
    }
  }
  await act(page, 'raise');
}

// オールイン演出の終了を待つ
async function waitOverlayGone(page, timeout = 8000) {
  await page.waitForFunction(() => {
    const ov = document.getElementById('cc-allin-overlay');
    return !ov || ov.style.display === 'none';
  }, null, { timeout });
}

// 「次のフェーズへ」を押す
async function nextPhase(page) {
  await page.waitForSelector('#cc-next-phase', { state: 'visible' });
  await page.click('#cc-next-phase');
}

// ショーダウン画面で勝者（プレイヤー番号）を選んで確定
async function award(page, winnerIdxs, pot = 0) {
  await page.waitForSelector('#cc-showdown', { state: 'visible' });
  for (const i of winnerIdxs) {
    await page.check(`.cc-winner-cb[data-pot="${pot}"][data-idx="${i}"]`);
  }
  await page.click('#cc-award-btn');
  await page.waitForSelector('#cc-result', { state: 'visible' });
}

// カードピッカーでカードを選んで確定。cards は 'A♠' のような文字列
async function pickCards(page, cards) {
  await page.waitForSelector('#cc-card-picker', { state: 'visible' });
  for (const c of cards) {
    const r = c.slice(0, -1), su = c.slice(-1);
    await page.click(`.cc-pick-card[data-r="${r}"][data-s="${su}"]`);
  }
  await page.click('#cc-picker-confirm');
}

// 「端末を渡してください」画面の準備OKを押す
async function passDevice(page) {
  await page.click('button:has-text("準備OK")');
}

async function nextHand(page) {
  await page.click('#cc-next-round');
}

async function undo(page) {
  await page.click('#cc-undo-btn');
}

module.exports = {
  openApp, closeBrowser, startOffline, state, historyLen, chipsConserved, visible,
  act, raiseTo, waitOverlayGone, nextPhase, award, nextHand, undo, pickCards, passDevice,
};
