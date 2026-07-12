# 経費くん Web デモ 🧾

**レシート画像や「コンビニ 500円」の一言を送るだけで、AI が経費を読み取り Google スプレッドシートへ自動記帳する Web デモ。**

🌐 **ライブデモ: https://keihi-web-demo.vercel.app**

Discord 経費 BOT の中核体験（レシート/テキスト → AI 抽出 → 確認 → シート記帳）を、**Discord もログインもセットアップも不要**でブラウザから試せるようにしたものです。Cloudflare Workers 版から **Vercel Edge Functions** へ移植し、GitHub 連携で自動デプロイできます。

---

## ✨ できること

送るだけ。3 ステップで記帳が終わります。

1. **送る** — レシート画像（貼り付け / ドラッグ&ドロップ / 添付）か、「スタバ ラテ 620円」のような一言テキストを入力
2. **AI が読み取る** — Gemini が **日付・金額・勘定科目・支払先・備考** を抽出
3. **確認して記帳** — 内容を確認（必要なら修正）して「記帳する」→ 共有スプレッドシートへ 1 行追記

### 主な機能
- 🧠 **AI 抽出** — 画像/テキストから経費データを構造化（`gemini-2.5-flash-lite`）
- 🃏 **確認カード** — Discord 風の UI で 記帳 / 修正 / キャンセル ＋ ワンタップ科目変更（ショートカット）
- 📸 **画像は自動圧縮** — スマホ写真は送信前に canvas でリサイズ・再圧縮（長辺 1600px・JPEG 0.8）。Edge のリクエストボディ上限に収め、通信量も削減
- 📒 **ライブ台帳** — 「みんなの記帳」で共有シートの直近記帳を表示（20 秒ポーリング／サーバー側 10 秒キャッシュで読み取りクォータを保護）
- ⚙️ **任意カスタマイズ** — 勘定科目マスタ／ショートカットをブラウザ内（localStorage）で編集
- 🌓 **ライト/ダーク対応・レスポンシブ**
- ♿ **アクセシビリティ配慮** — aria-label / dialog ロール / Esc 閉じ / `inert` フォーカストラップ / キーボード操作

---

## 🏗️ アーキテクチャ

単一の Vercel プロジェクトが **静的フロント** と **Edge Functions（API）** を同時に配信します。

```
ブラウザ (public/*)                    Vercel
  │  fetch /api/*                        │
  ├── POST /api/extract  ──────────────► Gemini REST API（経費抽出）
  ├── POST /api/record   ──┐
  ├── POST /api/fixed/run ─┤            サービスアカウント JWT を
  ├── GET  /api/recent   ──┤  ────────► WebCrypto で RS256 署名
  └── (Vercel Cron) ───────┘            → Google Sheets API（記帳/読取/トリム）
                                         Secrets は Vercel 環境変数（クライアント非露出）
```

### 設計上のポイント
- **秘密鍵は必ずサーバー側** — Gemini API キーと Google サービスアカウント鍵はブラウザに出さず、Edge Function 内でのみ使用。だから純静的ホスティング（GitHub Pages 等）では成立せず、Edge/サーバーレスが必須。
- **SDK 不使用・全て Web 標準 fetch** — Gemini も Google 認証も REST を `fetch` で直叩き。Google の JWT 署名は **WebCrypto (`crypto.subtle`)** で RS256、アクセストークンはモジュールスコープにキャッシュ。`googleapis` / `@google/genai` 等の重い依存はゼロ。
- **数式インジェクション対策** — Sheets への書き込みは `valueInputOption=RAW` 固定。`=IMPORTXML(...)` のような値が数式として実行されない。

---

## 🧰 技術スタック

| 領域 | 採用 |
|---|---|
| ランタイム | Vercel Edge Functions（Web 標準 API） |
| フロント | Vanilla JS / HTML / CSS（ビルド不要・依存ゼロ） |
| AI | Google Gemini `gemini-2.5-flash-lite`（REST・複数キー fallback） |
| データ | Google Sheets（サービスアカウント JWT + Sheets REST） |
| 言語 | TypeScript（lib/api）／型チェックのみ、バンドルは Vercel |
| スケジュール | Vercel Cron（日次でシートをトリム） |

---

## 📁 ディレクトリ構成

```
.
├── api/                     Edge Functions（各ファイル = 1 エンドポイント）
│   ├── extract.ts           POST /api/extract    レシート/テキスト → 経費抽出
│   ├── record.ts            POST /api/record     1 件を RAW 追記
│   ├── recent.ts            GET  /api/recent     直近行を取得（ライブ台帳）
│   ├── fixed/run.ts         POST /api/fixed/run  固定費まとめ記帳（デモUIは非表示）
│   └── cron/trim.ts         Vercel Cron          シートを直近200行にトリム
├── lib/
│   ├── gemini.ts            Gemini REST 抽出・プロンプト・fallback
│   ├── sheets.ts            JWT 署名(WebCrypto) / トークンキャッシュ / append・read・trim
│   ├── ratelimit.ts         IP 単位のインメモリ・レート制限
│   ├── http.ts              JSON 応答 / IP 取得 / 入力サニタイズ
│   ├── jst.ts               JST 基準の日付ユーティリティ
│   └── types.ts             ExpenseData / デフォルト科目 / env アクセサ
├── public/                  静的配信（Vercel が自動で `/` にマウント）
│   ├── index.html
│   ├── app.js               チャットUI・確認カード・設定ドロワー・localStorage
│   └── styles.css
├── vercel.json              Cron 設定
├── tsconfig.json
└── package.json
```

---

## 🔄 処理の流れ（詳細）

1. ユーザーがテキスト/画像を送信 → `POST /api/extract`
2. `lib/ratelimit` で IP レート制限チェック → `lib/gemini.extractExpenseData` が Gemini REST を呼び、JSON で経費データを取得。勘定科目はユーザーのマスタに束縛し、**サーバー側でもマスタ照合**して外れ値は「その他」へ丸める（レシート画像内の指示文によるプロンプトインジェクション対策）
3. フロントが確認カードを描画。金額を読み取れない場合は「記帳する」を無効化し修正へ誘導
4. 「記帳する」→ `POST /api/record` → `lib/http.sanitizeExpense` で検証（金額は正の整数のみ）→ `lib/sheets.appendExpense` が RAW で 1 行追記
5. 台帳は `GET /api/recent` を 20 秒ごとに取得。`lib/sheets` が結果を 10 秒キャッシュ（全訪問者で共有）し、閲覧者数に比例した Sheets 読み取りを防ぐ
6. 日次で `POST /api/cron/trim`（Vercel Cron）が古い行を削除（`CRON_SECRET` の Bearer 認証必須）

---

## 🚀 ローカル開発

```bash
npm install
npm run typecheck        # tsc --noEmit で型チェック
```

### ローカルで API まで動かす
`vercel dev` を使うと `/` と `/api/*` をローカル起動できます。環境変数は下記を **.env.local**（gitignore 済み）に置くか、`vercel env pull` で取得します。

```bash
npx vercel dev
```

### 依存なしで lib を直接 E2E
Node 22 は `fetch` / WebCrypto を標準搭載しているため、Vercel を介さず lib を実 API に対してテストできます（環境変数をセットして `lib/gemini` → `lib/sheets` を呼ぶだけ）。

---

## 🔑 環境変数

Vercel の **Settings → Environment Variables**（またはローカルは `.env.local`）に設定します。**すべて Secret 扱いでクライアントには一切出ません。**

| 変数 | 必須 | 説明 |
|---|:--:|---|
| `GEMINI_API_KEY` | ✅ | Gemini API キー（デモは無料枠推奨） |
| `GEMINI_API_KEY_2` / `_3` | | 追加キー（429/5xx 時に自動フォールバック） |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✅ | サービスアカウントのメール（`xxx@xxx.iam.gserviceaccount.com`） |
| `GOOGLE_PRIVATE_KEY` | ✅ | サービスアカウント秘密鍵。`-----BEGIN...END-----` を丸ごと（実改行 / `\n` エスケープどちらも可） |
| `DEMO_SHEET_ID` | ✅ | 記帳先スプレッドシートの ID（URL の `/d/<ここ>/edit`） |
| `DEMO_SHEET_TAB` | | 記帳先タブ名（既定 `デモ`） |
| `CRON_SECRET` | ▲ | `/api/cron/trim` の認証。**fail-closed** のため未設定だと cron は 500 で動かない（Vercel Cron が設定時に `Authorization: Bearer` を自動付与）。日次トリムを使うなら設定 |

### 事前準備（Google 側）
1. Google スプレッドシートを作成し、記帳用タブ（既定名 `デモ`）にヘッダ行（`日付 / 金額 / 勘定科目 / 支払先 / 備考 / 記帳時刻`）を用意
2. Google Cloud でサービスアカウントを作成し、JSON 鍵を発行
3. そのサービスアカウントのメールを、スプレッドシートの **編集者** として共有に追加
4. Google Cloud で **Google Sheets API** を有効化

---

## ☁️ デプロイ（Vercel）

### 方法 A: GitHub 連携（推奨）
1. このリポジトリを Vercel にインポート（Add New → Project）
2. Framework Preset = **Other**、Root Directory = リポジトリ直下
3. 環境変数を登録 → Deploy
4. 以後 `git push` で自動デプロイ

### 方法 B: Vercel CLI
```bash
npx vercel link
# 環境変数を登録（例）
npx vercel env add GEMINI_API_KEY production
# ... 他の変数も同様に
npx vercel deploy --prod
```

公開 URL は `https://<project>.vercel.app`。

---

## 🛡️ セキュリティ / 濫用対策

- **秘密情報は全て Vercel 環境変数** — クライアント JS に一切露出しない
- **RAW 固定** — Sheets 書き込みで数式インジェクション（`=IMPORTXML(...)` 等）を無効化
- **プロンプトインジェクション対策** — Gemini 返却の勘定科目をサーバー側でマスタ照合し、外れ値を丸める。categories の制御文字も除去
- **入力サニタイズ** — 金額は正の整数のみ、各フィールド長を制限
- **レート制限** — extract/record は IP 単位で 6 回/分・40 回/時（インメモリ best-effort）。台帳読み取りは 10 秒キャッシュで保護
- **画像は圧縮して送信** — クライアントで長辺 1600px・JPEG 0.8 に再圧縮（Edge のボディ上限超過を回避）
- **cron は fail-closed** — `CRON_SECRET` 未設定なら実行拒否。GET/POST 以外も拒否
- **セキュリティヘッダ** — CSP（`default-src 'self'` ＋ 画像は data:/blob: のみ）・`X-Content-Type-Options: nosniff`・`X-Frame-Options: DENY`・`Referrer-Policy`
- **内部エラーの非露出** — Google API の生エラー詳細はサーバーログのみ、クライアントには固定メッセージ
- **日次トリム** — 共有シートを直近 200 行に保つ

> 公開デモのため、記帳内容は共有シートに入ります。個人情報や本物の金額は入力しないでください。

---

## ♿ アクセシビリティ

- アイコンボタンに `aria-label`、装飾絵文字は `aria-hidden`
- モーダル/ドロワーに `role="dialog"` / `aria-modal`、**Esc で閉じる**、開閉時のフォーカス移動・復帰
- **フォーカストラップ** — ダイアログ表示中は背景（header/notice/main）に `inert` を付与し、Tab が背後に抜けない
- 修正モーダルは `<form>` 化して **Enter で反映**
- 画像添付はキーボード到達可能（視覚的非表示の file input）
- トーストは `role="status"` `aria-live`、メッセージ領域は `aria-live="polite"`
- 台帳は内容不変時に再描画せず、スクリーンリーダーの読み上げ位置を保護

---

## 📝 制約・メモ

- レート制限は Edge インスタンス毎のインメモリで best-effort。厳密にするなら Upstash Redis 等の外部ストアに置き換え可能。
- 固定費（毎月の自動記帳）機能はコードに存在しますが、デモ UI では非表示にしています（`public/index.html` の該当 `section` の `hidden` を外せば復活）。
- 記帳先シートを訪問者にも見せるには、シートの共有設定を「リンクを知る全員: 閲覧者」にしてください。

## 🔗 由来
このデモは Discord 経費 BOT（Node.js + discord.js + better-sqlite3）の中核体験を Web に移植したものです。プロンプト・デフォルト勘定科目・RAW 追記・JST 日付処理などのロジックを踏襲しています。
