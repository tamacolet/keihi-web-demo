# 経費くん Webデモ版（Vercel）

Discord 経費BOTの核（レシート/テキスト → AI抽出 → 確認 → スプレッドシート記帳）を、Discordもセットアップも不要でブラウザから試せる公開デモ。**Vercel Edge Functions ＋ 静的配信**、GitHub 連携で自動デプロイ。

## 特徴
- レシート画像 or 一言テキスト → Gemini が日付・金額・勘定科目・支払先・備考を抽出
- Discord風の確認カード（記帳する / 修正する / キャンセル ＋ ショートカット・チップ）
- 「みんなの記帳」ライブ台帳（共有デモシートの直近行）
- 設定ドロワーで勘定科目マスタ／ショートカット／固定費を編集（localStorage）＋固定費の一括記帳
- 濫用対策: IPレート制限（best-effort）・Sheets は RAW 固定（数式インジェクション不可）・画像サイズ上限・シート日次トリム

## 構成
```
vercel-demo/
  api/                Edge Functions
    extract.ts        POST: Gemini抽出
    record.ts         POST: 1件記帳（RAW追記）
    recent.ts         GET : 直近行取得
    fixed/run.ts      POST: 固定費まとめ記帳
    cron/trim.ts      日次トリム（Vercel Cron）
  lib/                gemini / sheets(JWT WebCrypto) / ratelimit / http / jst / types
  public/             index.html / app.js / styles.css（静的配信）
  vercel.json         crons 設定
```
- Gemini は SDK ではなく REST を fetch（`gemini-2.5-flash-lite`）。複数キー fallback。
- Google 認証は googleapis を使わず、サービスアカウント JWT を **WebCrypto** で RS256 署名 → アクセストークンをモジュールにキャッシュ。

## デプロイ手順

### 1. 事前準備
- **デモ共有 Google シート**（タブ「デモ」、ヘッダ行）を用意し、サービスアカウントを編集者に共有。※本デモは既に設定済み（シート `1dBl5ZDx...`、SA `keihi-demo-bot@nansenurl.iam.gserviceaccount.com`）。
- **Gemini APIキー**（デモ専用・無料枠推奨）。

### 2. GitHub へ push
このディレクトリ（`vercel-demo/`）をリポジトリのルートにして push。

### 3. Vercel でインポート
Vercel dashboard → Add New → Project → GitHub リポを選択。
- **Root Directory** = `vercel-demo`（モノレポの場合）
- Framework Preset = **Other**（静的＋Functions を自動検出）

### 4. Environment Variables を登録
Vercel の Settings → Environment Variables に:
```
GEMINI_API_KEY            (+ GEMINI_API_KEY_2 / _3 任意)
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY        -----BEGIN...END----- を丸ごと（改行込み or \n エスケープ、どちらも可）
DEMO_SHEET_ID
DEMO_SHEET_TAB           (任意, 既定 "デモ")
CRON_SECRET              (任意, cron 保護用)
```

### 5. Deploy
`https://<project>.vercel.app` が公開URL。以後 `git push` で自動デプロイ。

## ローカル検証
- 型チェック: `npm install && npm run typecheck`
- lib の実E2E（Vercelアカウント不要）: Node ハーネスで `lib/gemini` → `lib/sheets` を実 Gemini/実シートに対して実行。
- `vercel dev` が使えれば `/` と `/api/*` をローカル確認。

## 注意
- 公開デモのため共有シートは誰でも閲覧可・日次で直近200行にトリム。
- Secrets はすべて Vercel 側。クライアントJSには一切露出しない。
- レート制限はインメモリ best-effort（無料枠キー運用のため）。堅牢化するなら Upstash Redis を追加。
