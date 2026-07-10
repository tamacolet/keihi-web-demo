export const config = { runtime: 'edge' };

import { appendExpense } from '../lib/sheets';
import { checkRateLimit } from '../lib/ratelimit';
import { json, clientIp, sanitizeExpense } from '../lib/http';

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

    try {
        const data = sanitizeExpense(payload?.data ?? payload);
        await appendExpense(data);
        return json({ ok: true, data });
    } catch (e: any) {
        return json({ error: e?.message || '記帳に失敗しました。' }, 400);
    }
}
