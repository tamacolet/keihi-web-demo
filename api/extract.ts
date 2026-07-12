export const config = { runtime: 'edge' };

import { extractExpenseData } from '../lib/gemini';
import { checkRateLimit } from '../lib/ratelimit';
import { json, clientIp } from '../lib/http';

// 制御文字（改行・タブ含む）を除去。クライアント経由で systemInstruction を汚さないため。
const stripCtrl = (s: string) => Array.from(s).filter(ch => { const n = ch.charCodeAt(0); return n >= 32 && n !== 127; }).join("");

export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const rl = checkRateLimit(clientIp(req), 1);
    if (!rl.ok) return json({ error: rl.message }, 429);

    let payload: any;
    try {
        payload = await req.json();
    } catch {
        return json({ error: '不正なリクエストです。' }, 400);
    }

    const categories: string[] = Array.isArray(payload?.categories) && payload.categories.length
        ? payload.categories.map((c: any) => stripCtrl(String(c)).slice(0, 50)).filter(Boolean).slice(0, 50)
        : [];

    try {
        const data = await extractExpenseData({
            text: String(payload?.text || ''),
            imageBase64: payload?.imageBase64 ? String(payload.imageBase64) : undefined,
            mimeType: payload?.mimeType ? String(payload.mimeType) : undefined,
            categories: categories.length ? categories : ['食費', '交通費', 'その他']
        });
        return json({ data });
    } catch (e: any) {
        return json({ error: e?.message || '抽出に失敗しました。' }, 400);
    }
}
