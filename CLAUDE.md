# 共通費用くん — Claude Code 向け規約

- 仕様は SPEC.md。これと矛盾する判断は SPEC.md が正。仕様に書いてあることは聞き返さない。書いてないことで迷ったら聞く
- 午前2くん（github.com/kashinya/gozen2kun、公開: https://kashinya.github.io/gozen2kun/ ）と同じ流儀。着手前にそのリポジトリの index.html / app.js / style.css / manifest.webmanifest を読んで作りを把握する
- ファイル構成: index.html / app.js / settlement.js / firebase-config.js / style.css / icons/ / database.rules.json / test/ / README.md。静的な manifest.webmanifest は置かない（app.js が URL ごとに生成する。SPEC.md 3.7）。ビルドなし、npm なし、フレームワークなし、bundler なし
- app.js は `<script type="module">`。Firebase は https://www.gstatic.com/firebasejs/ の modular SDK（最新の安定版）だけを import。それ以外の外部依存は禁止
- style.css は午前2くんの CSS 変数（--bg --surface --text --muted --line --primary …）、light/dark の切替、トップバー、max-width 640px、system-ui フォント、safe-area をそのまま流用する。デカ数字のタイルはこのアプリ用に足す
- 識別は URL のクエリ（?g={グループ名}&n={名前}）、画面の切替はハッシュ（#history #settlements #settle）。パスルーティング禁止（GitHub Pages）。画面を切り替えてもクエリ部分は変えない。名前を選んだら history.replaceState で ?n= を付ける
- ホーム画面アイコンはグループごと。manifest の start_url は現在の pathname + search、name は グループ名。apple-mobile-web-app-capable / apple-mobile-web-app-title / apple-touch-icon のメタも必ず置く
- 通貨記号・単位は一切出さない。数字は 3 桁区切り。金額は整数のみ
- 精算ロジックは settlement.js の純関数 `computeSettlement(expenses, members)` に閉じ込める。UI からも Firebase トランザクションからも同じ関数を呼ぶ。test/settlement.test.mjs に SPEC.md 4.4 の 3 例を書き、`node --test test/` で通す
- 競合しうる書き込み（グループ作成・メンバー追加・取消・精算・終了）は runTransaction。トランザクションのコールバックに副作用を書かない
- firebase-config.js は git 管理する（公開前提）。初期状態はプレースホルダで、未設定なら画面に案内を出す。俺（kt）が Firebase コンソールで作った設定を貼る
- localStorage のキーは `kyotsuhiyokun.v1`（午前2くんと同じ流儀）。中身は {グループ名: 名前}。URL の n= があればそちらが正で、localStorage は補助
- 日本語 UI。console.log を残さない。innerHTML に入れる文字列は必ずエスケープ（午前2くんの esc() と同じ）
- 報告は短く。各段階の終わりに「作ったもの・次に俺がやること」を 3 行以内
