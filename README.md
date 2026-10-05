# 共通費用くん

旅行中の共通費用を「誰がいくら出したか」で積み上げ、精算ボタンで均等割りの差額を清算する割り勘 Web アプリ。認証なし。GitHub Pages の静的サイトで、共有データだけ Firebase Realtime Database に置く。ビルド不要。仕様は SPEC.md。

- URL だけで「どのグループを、誰として」開くかが決まる：`?g=パタヤ&n=kt`
- 画面の切替はハッシュ：`#history`（費用履歴）`#settlements`（精算履歴）`#settle`（精算プレビュー）
- ホーム画面のアイコンはグループごとに置ける（manifest を URL ごとに生成する）

## ファイル

| ファイル | 中身 |
| --- | --- |
| `index.html` | 外枠（トップバーと `<main>`）、apple-* メタ |
| `app.js` | 画面、URL ルータ、Firebase の読み書き、manifest の生成（`type="module"`） |
| `settlement.js` | 精算計算の純関数 `computeSettlement(expenses, members)`。画面とトランザクションの両方から使う |
| `firebase-config.js` | Firebase の設定値（公開前提で git 管理する） |
| `style.css` | 見た目（午前2くんの CSS 変数・ライト/ダーク・トップバーを流用） |
| `icons/` | ホーム画面アイコン 192 / 512 |
| `database.rules.json` | Realtime Database のセキュリティルール（コンソールに貼る） |
| `test/settlement.test.mjs` | 精算計算のテスト（SPEC.md 4.4 の 3 例ほか） |

## Firebase の準備（kt がやる、5〜10 分）

コンソールの文言は変わることがある。迷ったら近い名前のメニューを選ぶ。

1. https://console.firebase.google.com/ で「プロジェクトを追加」。名前は何でもよい（例：`kyotsuhiyokun`）。Google アナリティクスは不要。
2. 左メニュー「構築」→「Realtime Database」→「データベースを作成」。
   - ロケーション：**シンガポール（asia-southeast1）**
   - セキュリティルール：「ロックモードで開始」でよい（次で置き換える）
3. Realtime Database の「ルール」タブを開き、中身を全部消して `database.rules.json` の内容を貼り、「公開」。
4. プロジェクトの概要（歯車）→「プロジェクトの設定」→「マイアプリ」で「ウェブ」（`</>`）を追加。ニックネームは何でもよい。Firebase Hosting は**設定しない**。
5. 表示された `firebaseConfig` の値を `firebase-config.js` の各項目に貼る。
   - `databaseURL` が必須。表示に無ければ Realtime Database の「データ」タブ上部の URL（`https://<プロジェクトID>-default-rtdb.asia-southeast1.firebasedatabase.app`）を貼る。
6. 手元で確認：このフォルダで `python3 -m http.server`（または `python -m http.server`）を実行し、http://localhost:8000/ を開く。
   - 設定前は「firebase-config.js を設定してください」が出る。
   - 設定後は入口（グループ名の入力欄）が出る。

`firebase-config.js` の値はページのソースに載る。守っているのはルールだけで、URL を知った人はデータを書き換えられる（身内用と割り切る。グループ丸ごとの削除だけルールで防いでいる）。

## GitHub Pages で公開

1. GitHub にリポジトリを作る（仮：`kashinya/kyotsuhiyokun`）。
2. push する。
3. リポジトリの Settings → Pages → Build and deployment：Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にして Save。
4. 数分後に https://kashinya.github.io/kyotsuhiyokun/ で開ける。

## iPhone でグループごとにホーム画面へ置く

1. Safari で自分用の URL（`…/kyotsuhiyokun/?g=パタヤ&n=kt`）を開く。初めてなら入口 → グループ名 → 名前を選ぶと、この URL に自動で変わる。
2. 共有ボタン →「ホーム画面に追加」。名前欄がグループ名（例：パタヤ）になっていることを確認して「追加」。
3. 別のグループ（例：ミャンマー）も同じようにその URL を開いて追加する。
4. 各アイコンをタップすると、そのグループのメイン画面が自分の名前で開く。

招待はメイン画面の「共有リンクをコピー」（`?g=パタヤ` の URL）を LINE で送る。受け取った人は名前を選ぶと、自分用の URL に変わる。

ホーム画面のアイコンは Safari と別の保存領域で動くが、URL に `n=` が入っているので名前を選び直す必要はない。localStorage が消えても、自分用の URL を開けば同じ画面が出る。

## テスト

```
node --test
```

`test/` 以下の `*.test.mjs` を実行する。Node 24（手元で確認）では `node --test test/` のようにディレクトリを渡すと「Cannot find module」で失敗するので、引数なしか `node --test "test/*.test.mjs"` で実行する。

## データ構造

SPEC.md 5 章のとおり。`groups/{グループ名}` を丸ごと購読し、今期間の累計は保存せずに毎回 `expenses` から集計する。グループ作成・メンバー追加・取消・精算・終了は `runTransaction`、費用追加は `push`。
