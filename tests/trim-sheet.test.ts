import assert from 'node:assert/strict';
import test from 'node:test';

import { trimSheet } from '../lib/sheets';

process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----';
process.env.DEMO_SHEET_ID = 'test-sheet';
process.env.DEMO_SHEET_TAB = 'デモ';

Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
        subtle: {
            importKey: async () => ({}),
            sign: async () => new Uint8Array([1, 2, 3]).buffer
        }
    }
});

interface Scenario {
    metadata?: Response;
    values?: Response;
    update?: Response;
}

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function installFetch(scenario: Scenario): { updateBodies: string[] } {
    const calls = { updateBodies: [] as string[] };

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') {
            return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
        }
        if (url.includes('?fields=sheets.properties')) {
            return scenario.metadata ?? jsonResponse({ sheets: [{ properties: { sheetId: 123, title: 'デモ' } }] });
        }
        if (url.includes('/values/')) {
            return scenario.values ?? jsonResponse({ values: [['日付'], ...Array.from({ length: 201 }, () => ['2026-07-16'])] });
        }
        if (url.endsWith(':batchUpdate')) {
            calls.updateBodies.push(String(init?.body ?? ''));
            return scenario.update ?? jsonResponse({});
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    return calls;
}

test('trimSheet reports failures instead of returning success', async (t) => {
    const originalError = console.error;
    console.error = () => {};

    try {
        await t.test('rejects when sheet metadata cannot be read', async () => {
            installFetch({ metadata: jsonResponse({ error: 'unavailable' }, 503) });
            await assert.rejects(trimSheet(200), /シート情報の取得に失敗しました: 503/);
        });

        await t.test('rejects when the configured tab does not exist', async () => {
            installFetch({ metadata: jsonResponse({ sheets: [] }) });
            await assert.rejects(trimSheet(200), /トリム対象のタブ/);
        });

        await t.test('rejects when values cannot be read', async () => {
            installFetch({ values: jsonResponse({ error: 'unavailable' }, 503) });
            await assert.rejects(trimSheet(200), /トリム対象データの取得に失敗しました: 503/);
        });

        await t.test('rejects when old rows cannot be deleted', async () => {
            installFetch({ update: jsonResponse({ error: 'forbidden' }, 403) });
            await assert.rejects(trimSheet(200), /古い行の削除に失敗しました: 403/);
        });

        await t.test('deletes only rows exceeding the keep limit', async () => {
            const calls = installFetch({});
            await trimSheet(200);

            assert.equal(calls.updateBodies.length, 1);
            const body = JSON.parse(calls.updateBodies[0]);
            assert.deepEqual(body.requests[0].deleteDimension.range, {
                sheetId: 123,
                dimension: 'ROWS',
                startIndex: 1,
                endIndex: 2
            });
        });
    } finally {
        console.error = originalError;
    }
});
