export const config = { runtime: 'edge' };

import { getRecent } from '../lib/sheets';
import { json } from '../lib/http';

// レート制限はかけない（extract/record と同じIPバケットを共有するとポーリングが
// ユーザー自身の操作予算を食うため）。Sheets 読み取りは lib/sheets の10秒キャッシュで
// 全訪問者ぶんまとめて最大 6回/分 に抑えられており、これがクォータ保護になる。
export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    try {
        const rows = await getRecent(15);
        return json({ rows });
    } catch (e: any) {
        return json({ error: e?.message || '取得に失敗しました。', rows: [] }, 200);
    }
}
