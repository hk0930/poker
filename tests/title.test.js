// タイトル画面のテスト
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

const FILE = 'file://' + path.resolve(__dirname, '..', 'texas-poker-online.html');
let browser;
after(async () => { if (browser) await browser.close(); });

async function open(query, { showTitle = true } = {}) {
  if (!browser) browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route(/^https?:\/\//, (r) => r.abort());
  await page.addInitScript((v) => { window.__showTitle = v; }, showTitle);
  await page.goto(FILE + '?test=1' + (query || ''));
  return page;
}
const active = (page) => page.evaluate(() => document.querySelector('.screen.active').id);

test('タイトル: 開くとタイトルが出て、はじめるでロビーへ進む', async () => {
  const page = await open();
  assert.equal(await active(page), 'screen-title');
  assert.equal(await page.locator('#ttl-cards .ttl-card').count(), 5, 'カード5枚');
  assert.match(await page.textContent('.ttl-ver'), /^v\d{4}\.\d+\.\d+\.\d+-sdk$/, 'バージョンが出る');
  assert.ok(!(await page.isVisible('#btn-title-start')), '最初は「はじめる」はまだ出ない');
  assert.ok(await page.isVisible('#btn-title-tap'), 'TAP TO START が出る');
  await page.click('#btn-title-tap');
  assert.ok(!(await page.isVisible('#btn-title-tap')));
  await page.click('#btn-title-start');
  await page.waitForFunction(() => document.getElementById('screen-lobby').classList.contains('active'));
  assert.ok(await page.isVisible('#btn-mode-offline'));
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('タイトル: 遊び方を開ける', async () => {
  const page = await open();
  await page.click('.ttl-cards', { force: true }); // 画面のどこをタップしても始まる
  await page.click('#btn-title-guide');
  assert.ok(await page.isVisible('#guide-close'));
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('タイトル: 招待リンク（?join=）からはタイトルを飛ばす', async () => {
  const page = await open('&join=ABC234');
  assert.equal(await active(page), 'screen-lobby');
  await page.context().close();
});

test('タイトル: テストでは既定で出さない（ほかのテストはすぐロビーから始める）', async () => {
  const page = await open('', { showTitle: false });
  assert.equal(await active(page), 'screen-lobby');
  await page.context().close();
});

test('タイトル: タップするとタイトル曲が流れ、ロビーでも続き、ゲームでラウンジに変わる', async () => {
  const page = await open();
  await page.evaluate(() => { localStorage.setItem('poker_bgm', '1'); });
  await page.reload();
  const mode = () => page.evaluate(() => window.__poker.bgmMode);
  assert.equal(await active(page), 'screen-title');
  await page.click('#btn-title-tap');
  assert.equal(await mode(), 'title', 'タップでタイトル曲');
  await page.click('#btn-title-start');
  await page.waitForFunction(() => document.getElementById('screen-lobby').classList.contains('active'));
  assert.equal(await mode(), 'title', 'ロビーでも続けて流れる');
  // ロビーの BGM ボタンで止められる
  await page.click('#screen-lobby .bgm-btn');
  assert.equal(await mode(), null);
  assert.equal(await page.getAttribute('#screen-lobby .bgm-btn', 'aria-pressed'), 'false');
  await page.click('#screen-lobby .bgm-btn');
  await page.click('#btn-mode-offline');
  await page.click('#btn-start-offline');
  assert.equal(await mode(), 'lounge', 'ゲームが始まるとラウンジ');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('タイトル: タイトルの BGM ボタンでオフにして始めると曲は流れない', async () => {
  const page = await open();
  await page.evaluate(() => { localStorage.setItem('poker_bgm', '1'); });
  await page.reload();
  await page.click('#screen-title .bgm-btn');
  assert.equal(await page.evaluate(() => window.__poker.bgmMode), null);
  assert.ok(await page.isVisible('#btn-title-start'), 'ボタンのタップでも始まる');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
