// インメモリ・レート制限（best-effort）。
// Vercel Edge のウォームインスタンス内で同一IPの連打を抑制する。
// Gemini は無料枠キー（課金リスク無し）のため、厳密な分散カウンタは不要。
// インスタンスが冷えるとリセットされるが、スパム抑止としてはこれで十分。

const PER_MINUTE = 6;
const PER_HOUR = 40;

interface Entry { minuteBucket: number; minuteCount: number; hourBucket: number; hourCount: number; }
const store = new Map<string, Entry>();

export interface RateResult {
    ok: boolean;
    message?: string;
}

/**
 * IP 単位のレート制限。cost は消費数（複数件記帳は件数分）。
 * ok=true のときのみカウンタを消費する。
 */
export function checkRateLimit(ip: string, cost = 1): RateResult {
    const now = Date.now();
    const minuteBucket = Math.floor(now / 60000);
    const hourBucket = Math.floor(now / 3600000);

    let e = store.get(ip);
    if (!e) { e = { minuteBucket, minuteCount: 0, hourBucket, hourCount: 0 }; store.set(ip, e); }

    if (e.minuteBucket !== minuteBucket) { e.minuteBucket = minuteBucket; e.minuteCount = 0; }
    if (e.hourBucket !== hourBucket) { e.hourBucket = hourBucket; e.hourCount = 0; }

    if (e.minuteCount + cost > PER_MINUTE) {
        return { ok: false, message: '少し時間をおいてから再度お試しください（数十秒後）。' };
    }
    if (e.hourCount + cost > PER_HOUR) {
        return { ok: false, message: '1時間あたりの上限に達しました。しばらくしてからお試しください。' };
    }

    e.minuteCount += cost;
    e.hourCount += cost;

    // 古いエントリの粗いGC（メモリ肥大防止）
    if (store.size > 5000) {
        for (const [k, v] of store) {
            if (v.hourBucket !== hourBucket) store.delete(k);
        }
    }

    return { ok: true };
}
