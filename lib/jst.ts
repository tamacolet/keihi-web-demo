// JST（日本標準時）基準の日付ユーティリティ。
// UTC基準だと JST 0:00〜8:59 が前日日付になり記帳日がズレるため必ずこちらを使う。

/** JST基準の本日の日付を YYYY-MM-DD で返す。 */
export function getTodayJST(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/** JST基準の記帳時刻文字列（ja-JP）。 */
export function nowStampJST(): string {
    return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}
