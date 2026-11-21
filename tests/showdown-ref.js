// ショーダウンの配分を確かめるための、アプリとは別に書いた参照実装
// （役の判定もサイドポットの計算もアプリのコードを使わない）
const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

// 5枚の強さを [役, 比べる数字...] の配列で返す（配列の辞書順で強弱が決まる）
function score5(cards) {
  const vals = cards.map((c) => RV[c.r]).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5 && vals[0] - vals[4] === 4) straightHigh = vals[0];
  if (uniq.length === 5 && vals.join() === '14,5,4,3,2') straightHigh = 5;
  const counts = {};
  vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  // 枚数の多い順、同じ枚数なら数字の大きい順
  const groups = Object.entries(counts).map(([v, c]) => [c, +v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const byGroup = groups.map((g) => g[1]);
  const shape = groups.map((g) => g[0]).join('');
  if (flush && straightHigh) return [8, straightHigh];
  if (shape === '41') return [7, ...byGroup];
  if (shape === '32') return [6, ...byGroup];
  if (flush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (shape === '311') return [3, ...byGroup];
  if (shape === '221') return [2, ...byGroup];
  if (shape === '2111') return [1, ...byGroup];
  return [0, ...vals];
}
function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}
function best7(cards) {
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const five = cards.filter((_, i) => i !== a && i !== b);
    const sc = score5(five);
    if (!best || cmp(sc, best) > 0) best = sc;
  }
  return best;
}

// 各プレイヤーが受け取るべき額（端数は誰に行くかアプリ次第なので、ポットごとの端数の合計も返す）
function expectedPayouts(before) {
  const ps = before.players;
  const contrib = ps.filter((p) => p.totalBet > 0);
  const live = ps.filter((p) => p.active && !p.folded);
  const levels = [...new Set(contrib.map((p) => p.totalBet))].sort((a, b) => a - b);
  const pay = {}; ps.forEach((p) => { pay[p.idx] = 0; });
  const pots = [];
  let prev = 0, odd = 0, orphan = 0;
  for (const lv of levels) {
    let amount = 0;
    contrib.forEach((p) => { amount += Math.min(p.totalBet, lv) - Math.min(p.totalBet, prev); });
    prev = lv;
    const elig = live.filter((p) => p.totalBet >= lv);
    if (!amount) continue;
    if (!elig.length) { orphan += amount; continue; } // フォールドした人だけが賭けた分
    const scored = elig.map((p) => ({ p, sc: best7(p.hole.concat(before.comm)) }));
    const top = scored.reduce((m, x) => (cmp(x.sc, m) > 0 ? x.sc : m), scored[0].sc);
    const winners = scored.filter((x) => cmp(x.sc, top) === 0).map((x) => x.p);
    const share = Math.floor(amount / winners.length);
    winners.forEach((w) => { pay[w.idx] += share; });
    odd += amount - share * winners.length;
    pots.push({ amount, eligible: elig.map((p) => p.name), winners: winners.map((w) => w.name) });
  }
  return { pay, pots, odd, orphan };
}

module.exports = { score5, best7, cmp, expectedPayouts };
