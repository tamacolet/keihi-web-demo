export const config = { runtime: 'edge' };

import { trimSheet } from '../../lib/sheets';
import { json } from '../../lib/http';

// Vercel Cron から日次で呼ばれ、デモシートを直近200行にトリムする。
// CRON_SECRET を設定している場合は Authorization ヘッダで検証する。
export default async function handler(req: Request): Promise<Response> {
    const secret = process.env.CRON_SECRET;
    if (secret) {
        const auth = req.headers.get('authorization');
        if (auth !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);
    }

    try {
        await trimSheet(200);
        return json({ ok: true });
    } catch (e: any) {
        return json({ error: e?.message || 'trim failed' }, 500);
    }
}
