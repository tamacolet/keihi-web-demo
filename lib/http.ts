// Edge Function 共通ヘルパ（JSON応答・IP取得・入力サニタイズ）。

import { ExpenseData } from './types';
import { getTodayJST } from './jst';

export function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}

/** Vercel はクライアントIPを x-forwarded-for（先頭）で渡す。 */
export function clientIp(req: Request): string {
    const xff = req.headers.get('x-forwarded-for') || '';
    return xff.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

/** クライアント入力を安全な ExpenseData に整える（金額は正の整数のみ許可）。 */
export function sanitizeExpense(input: any): ExpenseData {
    const amount = typeof input?.amount === 'number'
        ? Math.floor(input.amount)
        : parseInt(String(input?.amount ?? '').replace(/[^0-9]/g, ''), 10);

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('金額は1以上の数値で指定してください。');
    }

    const str = (v: any, max = 200) => String(v ?? '').slice(0, max);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.date || '')) ? input.date : getTodayJST();

    return {
        date,
        amount,
        category: str(input?.category, 50) || '未分類',
        payee: str(input?.payee, 100),
        notes: str(input?.notes, 300)
    };
}
