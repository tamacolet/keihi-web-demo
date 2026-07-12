export const config = { runtime: 'edge' };

import { trimSheet } from '../../lib/sheets';
import { json } from '../../lib/http';

// Vercel Cron から日次で呼ばれ、デモシートを直近200行にトリムする。
// fail-closed: CRON_SECRET 未設定なら常に拒否（誰でも叩ける状態を作らない）。
// Vercel Cron は CRON_SECRET 設定時に Authorization: Bearer を自動付与する。
export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const secret = process.env.CRON_SECRET;
    if (!secret) return json({ error: 'CRON_SECRET not configured' }, 500);
    if (req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);

    try {
        await trimSheet(200);
        return json({ ok: true });
    } catch (e: any) {
        return json({ error: e?.message || 'trim failed' }, 500);
    }
}
