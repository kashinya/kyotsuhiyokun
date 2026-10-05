共通費用くんを作ってくれ。

まず CLAUDE.md と SPEC.md を読め。次に午前2くん（github.com/kashinya/gozen2kun）のソースを読んで、同じ構成・同じ見た目の流儀で作る。

前提
- GitHub Pages の静的サイト + Firebase Realtime Database。サーバーコードは書かない
- ビルドなし、フレームワークなし、外部ライブラリは Firebase SDK（gstatic CDN）だけ
- Firebase プロジェクトの作成は俺がやる。firebase-config.js はプレースホルダで作り、未設定なら画面に案内を出す。俺がやる手順を README.md に書け
- database.rules.json は既に置いてある。そのまま使う
- URL だけで「どのグループを誰として開くか」が決まる（?g=パタヤ&n=kt）。ブックマークと iPhone のホーム画面アイコンをグループごとに置けるのが要件。SPEC.md 3.7 を落とすな

進め方
- SPEC.md の 9 章の順番で作る。段階ごとに何を作ったか 3 行で報告して次へ進む。全部終わるまで俺の返事を待つ必要はない。迷ったときだけ聞け
- 精算の computeSettlement は純関数にして、SPEC.md 4.4 の 3 例を node --test で通してから UI に組み込む
- 最後に git init と初回コミットまでやる。GitHub へのリポジトリ作成と Pages の有効化は、俺が「push して」と言ったらやれ

完了条件
- `python3 -m http.server` で開いて、firebase-config.js 未設定の案内が出る
- firebase-config.js を入れたら、2 台のスマホで同じグループを開いて金額が即時に同期する
- 精算の 3 例のテストが通る
- iPhone の Safari でグループ 2 つをそれぞれホーム画面に追加し、各アイコンが 1 タップで正しいグループ・正しい名前のメイン画面を開く（アイコン名がグループ名になっている）
- localStorage を消しても、個人用 URL を開けば同じ画面が出る
- 午前2くんと並べて違和感がない
