// 経費データの共通型（既存BOTの ExpenseData と同一構造）
export interface ExpenseData {
    date: string;     // YYYY-MM-DD
    amount: number;   // 円
    category: string; // 勘定科目
    payee: string;    // 支払先
    notes: string;    // 備考
}

// 既存BOT (src/db.ts) と同じデフォルト勘定科目マスタ
export const DEFAULT_CATEGORIES = [
    '食費', '交通費', '日用品費', '交際費', '趣味・娯楽',
    '水道光熱費', '通信費', '住居費', '医療費', '衣服・美容', 'その他'
];

// --- 環境変数アクセスヘルパ（Vercel は process.env） ---
export function geminiKeys(): string[] {
    return [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3
    ].filter(Boolean) as string[];
}

export interface ServiceAccount {
    email: string;
    privateKey: string;
    sheetId: string;
    tab: string;
}

export function serviceAccount(): ServiceAccount {
    return {
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
        privateKey: process.env.GOOGLE_PRIVATE_KEY || '',
        sheetId: process.env.DEMO_SHEET_ID || '',
        tab: process.env.DEMO_SHEET_TAB || 'デモ'
    };
}
