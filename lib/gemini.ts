// Gemini REST でレシート/テキストから経費データを抽出する（Vercel Edge 版）。
// 既存の Cloudflare 版と同一ロジック。キーは process.env（geminiKeys()）から取得。

import { ExpenseData, geminiKeys } from './types';
import { getTodayJST } from './jst';

const MODEL = 'gemini-2.5-flash-lite';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB（base64デコード後サイズ目安）

export interface ExtractInput {
    text: string;
    imageBase64?: string;
    mimeType?: string;
    categories: string[];
}

function buildSystemInstruction(categories: string[], today: string): string {
    const validCategories = categories.join(', ');
    return `
あなたは経費精算のアシスタントです。
提供されたテキスト、またはレシート画像から以下の経費データを抽出し、JSON形式で返答してください。
{
  "date": "YYYY-MM-DD（日付が不明な場合は本日の日付(${today})を推測して記入）",
  "amount": 数値（円マークやカンマを除いた純粋な数字）,
  "category": "勘定科目マスタの中から最も適切なもの",
  "payee": "支払先（店名や会社名など。不明な場合は空白）",
  "notes": "その他備考があれば（何を買ったかなど）"
}

【重要規則】
- 「category」は必ず以下の勘定科目マスタリストの中からのみ選択し、一言一句違えないように出力してください。
  ■ 勘定科目マスタ: [${validCategories}]
- 万が一どれにも該当しないと判断した場合は、「その他」あるいはそれに最も近い項目を選んでください。マスタ外の単語は生成禁止です。

必ずJSONのみを出力してください。マークダウンのコードブロックなどは不要です。
`;
}

function normalize(raw: any, today: string): ExpenseData {
    let amount = raw?.amount;
    if (typeof amount !== 'number' || isNaN(amount)) {
        amount = parseInt(String(amount ?? '').replace(/[^0-9]/g, ''), 10) || 0;
    }
    return {
        date: raw?.date || today,
        amount,
        category: raw?.category || '未分類',
        payee: raw?.payee || '',
        notes: raw?.notes || ''
    };
}

export async function extractExpenseData(input: ExtractInput): Promise<ExpenseData> {
    const content = (input.text || '').trim();
    const hasImage = !!(input.imageBase64 && input.mimeType);

    if (!content && !hasImage) {
        throw new Error('画像またはテキストが必要です。');
    }
    if (hasImage && !input.mimeType!.startsWith('image/')) {
        throw new Error('画像ファイル、またはテキストで経費内容を送ってください。');
    }
    if (hasImage) {
        const approxBytes = Math.floor(input.imageBase64!.length * 0.75);
        if (approxBytes > MAX_IMAGE_BYTES) {
            throw new Error(`画像が大きすぎます（上限 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB）。小さい画像で送ってください。`);
        }
    }

    const keys = geminiKeys();
    if (keys.length === 0) throw new Error('サーバー設定エラー: GEMINI_API_KEY が未設定です。');

    const today = getTodayJST();
    const systemInstruction = buildSystemInstruction(input.categories, today);

    const parts: any[] = [];
    if (hasImage) {
        const prompt = content
            ? `以下のテキストと画像を元に経費データを抽出してください。\nテキスト: ${content}`
            : `この画像から経費データを抽出してください。`;
        parts.push({ text: prompt });
        parts.push({ inlineData: { data: input.imageBase64, mimeType: input.mimeType } });
    } else {
        parts.push({ text: `以下のテキストから経費データを抽出してください。\nテキスト: ${content}` });
    }

    const body = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
        }
    };

    for (let i = 0; i < keys.length; i++) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${keys[i]}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const status = res.status;
                const retryable = status === 429 || (status >= 500 && status < 600);
                if (retryable && i < keys.length - 1) {
                    console.log(`Gemini key ${i + 1} failed (${status}). Trying backup key ${i + 2}...`);
                    continue;
                }
                throw new Error(`Gemini API error: ${status}`);
            }

            const json: any = await res.json();
            const textOut: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!textOut) throw new Error('Gemini API did not return text.');

            const parsed = JSON.parse(textOut.trim());
            return normalize(parsed, today);
        } catch (err: any) {
            console.error(`Gemini extraction error with key ${i + 1}:`, err?.message);
            if (i < keys.length - 1) continue;
            throw new Error('データの抽出に失敗しました。内容を確認してください。');
        }
    }

    throw new Error('データの抽出に失敗しました。すべてのAPIキーが失敗しました。');
}
