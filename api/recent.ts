export const config = { runtime: 'edge' };

import { getRecent } from '../lib/sheets';
import { json } from '../lib/http';

export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    try {
        const rows = await getRecent(15);
        return json({ rows });
    } catch (e: any) {
        return json({ error: e?.message || '取得に失敗しました。', rows: [] }, 200);
    }
}
