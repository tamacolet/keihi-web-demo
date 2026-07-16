// Google Sheets 連携（Vercel Edge 版・googleapis を使わない）。
// サービスアカウントの JWT を WebCrypto で RS256 署名 → アクセストークン取得
// （モジュールスコープにキャッシュ）→ values.append を RAW で実行。
// valueInputOption は常に RAW（数式インジェクション対策）。

import { ExpenseData, serviceAccount } from './types';
import { nowStampJST } from './jst';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// --- base64url ヘルパー ---
function base64urlFromBytes(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlFromString(str: string): string {
    return base64urlFromBytes(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
    const body = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s+/g, '');
    const bin = atob(body);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}

async function createSignedJwt(): Promise<string> {
    const sa = serviceAccount();
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
        iss: sa.email,
        scope: SHEETS_SCOPE,
        aud: TOKEN_ENDPOINT,
        exp: now + 3600,
        iat: now
    };
    const unsigned = `${base64urlFromString(JSON.stringify(header))}.${base64urlFromString(JSON.stringify(claim))}`;

    const pem = sa.privateKey.replace(/\\n/g, '\n');
    const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToArrayBuffer(pem),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    return `${unsigned}.${base64urlFromBytes(new Uint8Array(sig))}`;
}

// アクセストークンのモジュールスコープキャッシュ（ウォームインスタンス内で再利用）
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

    const jwt = await createSignedJwt();
    const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        })
    });
    if (!res.ok) {
        const detail = await res.text();
        throw new Error(`アクセストークン取得に失敗しました: ${res.status} ${detail}`);
    }
    const json: any = await res.json();
    cachedToken = { token: json.access_token, exp: now + (json.expires_in || 3600) };
    return cachedToken.token;
}

function quotedRange(cols: string): string {
    const t = serviceAccount().tab.replace(/'/g, "''");
    return `'${t}'!${cols}`;
}

function rowFromData(data: ExpenseData): (string | number)[] {
    return [data.date, data.amount, data.category, data.payee, data.notes, nowStampJST()];
}

export async function appendExpense(data: ExpenseData): Promise<void> {
    await appendExpenses([data]);
}

export async function appendExpenses(rows: ExpenseData[]): Promise<void> {
    if (rows.length === 0) return;
    const sa = serviceAccount();
    const token = await getAccessToken();
    const range = encodeURIComponent(quotedRange('A:F'));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sa.sheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ values: rows.map(rowFromData) })
    });

    if (!res.ok) {
        const detail = await res.text();
        console.error('Sheets append error:', res.status, detail);
        if (res.status === 403) {
            throw new Error('デモシートの編集権限がありません。サービスアカウントを編集者に追加してください。');
        }
        throw new Error('スプレッドシートへの書き込みに失敗しました。時間をおいてお試しください。');
    }
    recentCache = null; // 記帳したら台帳キャッシュを無効化し、次の取得で即反映
}

export interface RecentRow {
    date: string;
    amount: string;
    category: string;
    payee: string;
    notes: string;
    stamp: string;
}

// 台帳の直近行を短時間キャッシュ（全訪問者で共有）。20秒ポーリング×閲覧者数が
// そのまま Sheets 読み取りクォータを食わないようにする。
let recentCache: { rows: RecentRow[]; at: number } | null = null;
const RECENT_TTL_MS = 10_000;

export async function getRecent(limit = 15): Promise<RecentRow[]> {
    const now = Date.now();
    if (recentCache && now - recentCache.at < RECENT_TTL_MS) {
        return recentCache.rows.slice(0, limit);
    }
    const rows = await fetchRecent(limit);
    recentCache = { rows, at: now };
    return rows;
}

async function fetchRecent(limit: number): Promise<RecentRow[]> {
    const sa = serviceAccount();
    const token = await getAccessToken();
    const range = encodeURIComponent(quotedRange('A:F'));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sa.sheetId}/values/${range}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
        console.error('Sheets read error:', res.status, await res.text());
        throw new Error('シートの読み取りに失敗しました。時間をおいてお試しください。');
    }

    const json: any = await res.json();
    const values: string[][] = json.values || [];
    const data = values.length && /日付|date/i.test(values[0][0] || '') ? values.slice(1) : values;

    return data
        .slice(-limit)
        .reverse()
        .map((r) => ({
            date: r[0] || '',
            amount: r[1] || '',
            category: r[2] || '',
            payee: r[3] || '',
            notes: r[4] || '',
            stamp: r[5] || ''
        }));
}

export async function trimSheet(keep = 200): Promise<void> {
    const sa = serviceAccount();
    const token = await getAccessToken();

    const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sa.sheetId}?fields=sheets.properties(sheetId,title,gridProperties.rowCount)`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!metaRes.ok) {
        console.error('Sheets trim metadata error:', metaRes.status, await metaRes.text());
        throw new Error(`シート情報の取得に失敗しました: ${metaRes.status}`);
    }
    const meta: any = await metaRes.json();
    const sheet = (meta.sheets || []).find((s: any) => s.properties?.title === sa.tab);
    if (!sheet) throw new Error(`トリム対象のタブ「${sa.tab}」が見つかりません。`);
    const sheetId = sheet.properties.sheetId;

    const range = encodeURIComponent(quotedRange('A:F'));
    const valsRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sa.sheetId}/values/${range}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!valsRes.ok) {
        console.error('Sheets trim values error:', valsRes.status, await valsRes.text());
        throw new Error(`トリム対象データの取得に失敗しました: ${valsRes.status}`);
    }
    const vals: any = await valsRes.json();
    const total = (vals.values || []).length;
    const hasHeader = total > 0 && /日付|date/i.test(vals.values[0][0] || '');
    const headerRows = hasHeader ? 1 : 0;
    const dataRows = total - headerRows;
    if (dataRows <= keep) return;

    const removeCount = dataRows - keep;
    const startIndex = headerRows;
    const endIndex = headerRows + removeCount;

    const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sa.sheetId}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            requests: [
                { deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex, endIndex } } }
            ]
        })
    });
    if (!updateRes.ok) {
        console.error('Sheets trim delete error:', updateRes.status, await updateRes.text());
        throw new Error(`古い行の削除に失敗しました: ${updateRes.status}`);
    }
    recentCache = null;
}
