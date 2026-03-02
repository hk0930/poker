# Texas Hold'em Online - プロジェクト仕様書

## 概要
- **ファイル**: `texas-poker-online.html`（単一HTMLファイル、約3000行）
- **URL**: https://hk0930.github.io/poker/texas-poker-online.html
- **GitHub**: https://github.com/hk0930/poker
- **バージョン**: v2026.03.02.xx-sdk（更新時は必ずバージョン番号をインクリメント）

## ゲーム仕様
- **種類**: テキサスホールデムポーカー
- **モード**: オンライン対戦（Firebase）/ オフラインCPU対戦
- **CPU**: 1〜5人、難易度EASY/NORMAL/HARD、名前はアレックス/ソフィア/リオン/エマ/ルーカス/ミア
- **チップ最小単位**: 5（snap5()で丸める）
- **デフォルト**: 開始500チップ、SB=5、BB=10
- **リバイシステム**: チップ不足時に追加購入可能、CPUはホストが判断
- **ロビーへ戻るボタン**: ショーダウンモーダル表示時のみ使用可

## アーキテクチャ

### ホスト/クライアント構造
```
ホストブラウザ（サーバー役）
  ├── startRound() でラウンド開始
  ├── advance() でターン進行を計算
  ├── applyAction() でアクションを処理
  ├── CPU思考ループ（processCpuQueue）を実行
  └── pushState() でFirebaseに状態を書き込む

Firebase Realtime Database（データ中継）
  └── 状態を保存・配信するだけ

非ホストブラウザ（クライアント役）
  └── onState()でFirebaseの状態を受信して画面に反映
```

### Firebase構成
- **SDK**: Firebase Compat v10.12.2（`firebase-app-compat.js` + `firebase-database-compat.js`）
- **プロジェクト**: poker-cc448
- **DB URL**: https://poker-cc448-default-rtdb.asia-southeast1.firebasedatabase.app
- **Config**:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyB7Dr14Ce0bQX9mZLpQY3jdeT8umNv25xQ",
  authDomain: "poker-cc448.firebaseapp.com",
  databaseURL: "https://poker-cc448-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "poker-cc448",
  storageBucket: "poker-cc448.firebasestorage.app",
  messagingSenderId: "477320881493",
  appId: "1:477320881493:web:9149d7c6b589700f293bdc"
};
```

### Firebaseデータ構造
```
rooms/{code}/
  ├── status: 'waiting' | 'started' | 'transferring' | 'lobby'
  ├── hostId: string
  ├── SB, BB, cpuCount, cpuDifficulty
  ├── players/{myId}: { name, chips, ready, rebuyCount }
  ├── holes/{pid}: [card1, card2]  （手札、各プレイヤーのみ閲覧可）
  └── game/
      ├── state: { waitFor, phase, community, pot, players[], rid, reveal, showdown, result, gameEnd }
      └── action: { type, amount, ts, rid }  （非ホストのアクション送信）
```

## 主要グローバル変数

| 変数 | 説明 |
|------|------|
| `isHost` | ホストかどうか |
| `myId` | sessionStorageで永続化されたプレイヤーID |
| `myIdx` | players配列内の自分のインデックス |
| `myHole` | 自分の手札2枚 |
| `players[]` | 全プレイヤー情報（name, chips, hole, folded, allIn, active, eliminated, rebuyCount, pid, idx, isMe, isCpu） |
| `curIdx` | 現在のアクションプレイヤーのインデックス |
| `phase` | 0=プリフロップ, 1=フロップ, 2=ターン, 3=リバー, 4=ショーダウン |
| `community[]` | コミュニティカード |
| `pot` | ポット総額 |
| `acts[]` | 今のストリートでアクション済みプレイヤーのidxリスト |
| `_roundId` | ラウンドID（古いactionの再処理防止。非ホストはonStateで同期） |
| `_commAnimating` | コミュニティカードアニメーション中フラグ（グローバル宣言必須） |
| `_cpuBusy` | CPU処理中フラグ |
| `_cpuQueue[]` | CPUアクションキュー |
| `_departedPlayers[]` | 途中退席したプレイヤーの情報（最終結果画面で表示） |
| `offlineMode` | オフラインモードフラグ |
| `lastActTs` | 最後に処理したアクションのタイムスタンプ（重複防止） |

## 主要関数

### ゲーム進行
- `startRound()` / `startRoundOffline()` — ラウンド開始、ブラインド徴収、カード配布
- `advance()` / `advanceOffline()` — 次のプレイヤーへターン移行、フェーズ移行判定
- `nextPhase()` — フロップ/ターン/リバー/ショーダウンへ移行
- `applyAction(d)` — アクション（fold/check/call/raise/allin）を処理
- `rundownAllIn()` — 全員オールイン時に残りカードを一気に公開
- `processCpuQueue()` / `runCpuTurn(idx)` — CPU思考・アクション実行
- `checkEliminated(cb)` — 脱落判定・リバイ処理

### オンライン通信
- `pushState(extra)` — ホストがゲーム状態をFirebaseに書き込む（ridを必ず含める）
- `onState(st)` — 非ホストがFirebaseの状態変化を受信して処理
- `watchAction()` — ホストが非ホストのアクションをFirebaseで監視（skipInitial=trueで登録）
- `send(type, amount)` — アクション送信（ホストは直接処理、非ホストはFirebaseへ）
- `_pokerGoLobby()` — ロビーへ戻る処理（全Firebaseリスナーを停止してからshowScreen）

### 描画
- `renderAll()` — 全プレイヤーシート再描画（_commAnimating中はcomm-cardsを上書きしない）
- `renderAction()` / `renderActionOffline()` — アクションパネル表示
- `showMsg(title, body, commCards, btn1, btn2)` — ショーダウン/結果モーダル表示
- `showGameEndSummary()` — ゲーム終了サマリー（退席者含む全員の最終チップ表示）
- `cH(card, small, large)` — SVGカード描画
- `showPhaseOverlay(phase, cards, cb)` — フェーズ移行演出
- `showDealOverlay(hole, cb)` — ディール演出（1.8秒後にcb呼び出し）

## 重要な設計上の注意点

### 1. _commAnimatingのグローバル宣言
非ホスト側はstartRound()を呼ばないため、startRound()内でのみ初期化される変数は非ホストでundefinedになる。
`_commAnimating`, `_cpuBusy`, `_cpuQueue`は必ずグローバル変数として宣言する。

### 2. _roundIdの同期
- ホスト: `startRound()`で生成 → `pushState()`のstateに`rid`として含める
- 非ホスト: `onState()`でst.ridを受信したら即座に`_roundId = st.rid`に設定
- `watchAction()`のコールバックで`!d.rid || d.rid !== _roundId`ならskip（古いactionの再処理防止）

### 3. watchActionの登録方法
```javascript
// 必ずskipInitial=trueで登録（初回即時コールバックで古いデータを拾わないため）
fbOff(gamePath + '/action');
fbSet(gamePath + '/action', null, function() {
  lastActTs = Date.now();
  _roundId = Math.random().toString(36).slice(2,10);
  fbListen(gamePath + '/action', watchActionCb, true); // skipInitial=true
});
```

### 4. dealOverlayとonStateのタイミング競合
非ホスト側でdealOverlay終了とSTATE受信の順序は不定。
`_lastWaitFor`変数でSTATEを記録し、dealOverlayコールバック内で`_lastWaitFor === myId`ならrenderAction()を呼ぶ。

### 5. ホストのonState無効化
ホストは自分でゲーム状態を管理するため、Firebaseからの状態受信でゲームロジックを実行しない。
`onState()`でisHostの場合は `waitFor === myId`の時のみアクションパネル表示に使用する。

### 6. actsの初期化
```javascript
acts = [players[bb].idx];  // BBのみ「既アクション済み」として初期化
// SBはコール権があるため未アクション扱いにする
```

### 7. アクションパネル表示判定
`apVisible = document.getElementById('ap').style.display === 'block'`
これは`renderAll()`の**外・上部**で取得すること（forEachの中での取得はhoistingバグの原因）。

### 8. _pokerGoLobby()の注意点
```javascript
fbOff(roomPath);      // 必ず先頭でroomPathのリスナーを全停止
fbOff(gamePath + '/state');
fbOff(gamePath + '/action');
fbOff(holePfx + myId);
// 以降にFirebase書き込みとshowScreen('screen-lobby')
```

## アクションフロー

### ホスト側アクション
```
send(type, amount)
  → applyAction(d)
  → advance()
    → pushState({waitFor: curP.pid, rid: _roundId, ...})
    → if curP.isCpu: processCpuQueue(curIdx)
```

### 非ホスト側アクション
```
send(type, amount)
  → fbSet(gamePath+'/action', {type, amount, ts, rid: _roundId})
  → showInfo('送信中...')

watchAction (ホスト側リスナー)
  → applyAction(d)
  → advance()
  → pushState(...)
```

### 非ホスト側のSTATE受信
```
onState(st)
  → _roundId = st.rid  // 必ず同期
  → curIdx = st.curIdx
  → pot, phase等を更新
  → renderAll()
  → if st.waitFor === myId:
      apEl.style.display = 'block'
      renderAction()  // dealOverlay中でも呼ぶ
  → if st.showdown: handleSD(st.showdown)
  → if st.result: handleResult(st.result)
```

## カードUI

### SVGカード描画
- 数字カード(2-10): 実際のトランプと同じピップ配置
- 絵札(J/Q/K): 絵文字で表現
- エース: 中央に大きなスートマーク
- スート: ♠♥♦♣をSVGパスで正確な形状で描画
- 裏面: チェッカーパターンのネイビー＋金の枠線

### アニメーション
- コミュニティカードフリップ: 0.8秒の3D回転
- フェーズ移行オーバーレイ: 1800ms以上表示
- ALL INカード公開: 全員分フリップ後3.5秒表示してからFLOPへ
- カード間インターバル: 320ms

## その他の機能

### オールインルール
- オールイン額がcurBet超かつlastRaise以上→フルレイズ扱い（全員再アクション）
- フルレイズ未満のオールイン→既アクション済みプレイヤーは再アクション不要
- サイドポット計算: `calcSidePots(cont)` でcontを引数で渡す（同一オブジェクト参照保証）

### ホスト移譲
- ホスト退出時: `status:'transferring'`をFirebaseに書き込み
- 非ホストが検知: `_watchHostPresence`で監視、モーダル表示
- 新ホスト: 「続ける」押下後Firebaseからプレイヤーリストを再取得してstartRound()

### 画面スリープ防止
1. Screen Wake Lock API（優先）
2. Base64インライン動画ループ（フォールバック）
- ゲーム開始時に有効化、ロビーへ戻る時に無効化

### リバイシステム
- チップ < BB になったプレイヤーに確認モーダル
- CPU: ホストが代わりに確認
- シートに `×N` バッジで購入回数を表示

## よくある不具合と原因

| 症状 | 原因 | 対処 |
|------|------|------|
| CPUがスタックする | `_cpuRunning`フラグが解除されない、または変数未定義 | try-finallyでフラグ確実リセット、グローバル宣言確認 |
| 非ホストがアクションできない | `_commAnimating`未定義でrenderAll()がクラッシュ | グローバル変数として宣言 |
| 非ホストのアクションが無視される | `_roundId`が同期されていない、actionのridが空 | `onState`でst.ridを受信したら即同期 |
| pushStateが複数回呼ばれる | 古いaction（ridなし）が再処理される | `!d.rid \|\| d.rid !== _roundId`でスキップ |
| ロビーへ戻れない | roomPathのリスナーが残り`status:'transferring'`を誤検知 | `_pokerGoLobby()`冒頭で`fbOff(roomPath)` |
| ショーダウンで全員勝者表示 | `calcSidePots()`のeligibleが別オブジェクト参照 | `calcSidePots(cont)`でcontを引数渡し |
| 「ホスト待ち」が消えない | dealOverlayとSTATEのタイミング競合 | `_lastWaitFor`で記録、dealOverlayコールバックで確認 |
| Firebase NULLが繰り返される | fbSet書き込み中にpollingが走る（以前のREST方式の問題） | SDK移行で解決済み |

## 修正履歴サマリー

- **オフラインモード**: 外部通信を完全排除してサンドボックスでも動作
- **Firebase統合**: REST API → SDK (WebSocket) 移行でレイテンシ大幅改善
- **SVGカード**: 本格的なトランプデザイン、絵札・スート形状
- **チップUI**: 実際のポーカーチップ（500/100/25/10/5）、枚数表示
- **アニメーション**: フリップ、フェーズ移行、ディール演出、ALL INカード公開
- **ショーダウン**: コミュニティカード表示、勝因説明（キッカー理由）、脱落判定
- **オンライン機能**: ルームコード、招待URL、CPU追加、ホスト移譲
- **リバイシステム**: チップ不足時の追加購入、CPU分はホストが判断
- **ゲーム終了サマリー**: 退席者含む全プレイヤーの最終結果表示
