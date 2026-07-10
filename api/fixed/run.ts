export const config = { runtime: 'edge' };

import { ExpenseData } from '../../lib/types';
import { appendExpenses } from '../../lib/sheets';
import { checkRateLimit } from '../../lib/ratelimit';
import { json, clientIp, sanitizeExpense } from '../../lib/http';
import { getTodayJST } from '../../lib/jst';

const MAX_FIXED_ITEMS = 20;

export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let payload: any;
    try {
        payload = await req.json();
    } catch {
        return json({ error: '不正なリクエストです。' }, 400);
    }

    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    if (rawItems.length === 0) return json({ error: '固定費が登録されていません。' }, 400);
    if (rawItems.length > MAX_FIXED_ITEMS) {
        return json({ error: `固定費は最大 ${MAX_FIXED_ITEMS} 件までです。` }, 400);
    }

    let items: ExpenseData[];
    try {
        items = rawItems.map((it: any) => sanitizeExpense({ ...it, date: getTodayJST() }));
    } catch (e: any) {
        return json({ error: e?.message || '固定費データが不正です。' }, 400);
    }

    const rl = checkRateLimit(clientIp(req), items.length);
    if (!rl.ok) return json({ error: rl.message }, 429);

    try {
        await appendExpenses(items);
        return json({ ok: true, count: items.length, items });
    } catch (e: any) {
        return json({ error: e?.message || '記帳に失敗しました。' }, 400);
    }
}
