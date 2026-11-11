// テスト用の偽 Firebase Realtime Database
// Node 側にデータを1つ持ち、複数のブラウザ画面（=端末）から読み書き・購読できる。
// 本物と同じく null・空の配列/オブジェクトは保存されない。

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

function prune(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    const arr = v.map(prune);
    return arr.every((x) => x === null) ? null : arr;
  }
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      const p = prune(v[k]);
      if (p !== null) out[k] = p;
    }
    return Object.keys(out).length ? out : null;
  }
  return v;
}

const split = (path) => String(path).split('/').filter(Boolean);
const related = (a, b) => {
  const x = split(a), y = split(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false;
  return true;
};

class FakeDb {
  constructor() {
    this.root = null;
    this.subs = new Map(); // key -> {page, path, id}
  }

  read(path) {
    let node = this.root;
    for (const k of split(path)) {
      if (node === null || typeof node !== 'object') return null;
      node = node[k] === undefined ? null : node[k];
    }
    return clone(node);
  }

  write(path, val) {
    const keys = split(path);
    if (!keys.length) { this.root = prune(clone(val)); return; }
    const root = this.root && typeof this.root === 'object' ? this.root : {};
    let node = root;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!node[keys[i]] || typeof node[keys[i]] !== 'object') node[keys[i]] = {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = clone(val);
    this.root = prune(root);
  }

  changed(path) {
    for (const s of this.subs.values()) {
      if (related(s.path, path)) s.page.__fbQueue.push(['deliver', s.id, this.read(s.path)]);
    }
    for (const p of new Set([...this.subs.values()].map((s) => s.page))) pump(p);
  }

  // 1画面（=1端末）をこの偽DBにつなぐ。page.goto の前に呼ぶ
  async attach(page) {
    page.__fbQueue = [];
    page.__fbBusy = false;
    await page.exposeBinding('__fbOp', (src, op, path, arg) => {
      if (op === 'get') return this.read(path);
      if (op === 'set') { this.write(path, arg); this.changed(path); return null; }
      if (op === 'update') {
        for (const k of Object.keys(arg || {})) this.write(path + '/' + k, arg[k]);
        this.changed(path);
        return null;
      }
      if (op === 'on') {
        this.subs.set(page.__fbId + ':' + arg, { page, path, id: arg });
        page.__fbQueue.push(['deliver', arg, this.read(path)]);
        pump(page);
        return null;
      }
      if (op === 'off') { this.subs.delete(page.__fbId + ':' + arg); return null; }
      return null;
    });
    page.__fbId = Math.random().toString(36).slice(2);
    await page.addInitScript(() => {
      const handlers = {};
      let seq = 0;
      const snap = (v) => ({ exists: () => v !== null && v !== undefined, val: () => v });
      const db = {
        ref(path) {
          return {
            get: () => window.__fbOp('get', path).then(snap),
            set: (v) => window.__fbOp('set', path, v === undefined ? null : v),
            update: (v) => window.__fbOp('update', path, v),
            on(ev, cb) {
              const id = ++seq;
              handlers[id] = cb;
              window.__fbOp('on', path, id);
              return id;
            },
            off(ev, id) {
              delete handlers[id];
              window.__fbOp('off', path, id);
            },
          };
        },
      };
      window.__fbDeliver = (id, v) => { if (handlers[id]) handlers[id](snap(v)); };
      window.firebase = {
        apps: [],
        initializeApp() { const a = {}; this.apps.push(a); return a; },
        database: () => db,
      };
    });
  }
}

// 各画面への通知を順番どおりに1つずつ届ける
async function pump(page) {
  if (page.__fbBusy) return;
  page.__fbBusy = true;
  try {
    while (page.__fbQueue.length) {
      const [, id, val] = page.__fbQueue.shift();
      if (page.isClosed()) break;
      await page.evaluate(([i, v]) => window.__fbDeliver(i, v), [id, val]).catch(() => {});
    }
  } finally {
    page.__fbBusy = false;
  }
}

module.exports = { FakeDb };
