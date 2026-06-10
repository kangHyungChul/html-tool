/**
 * DOM·엑셀 문자열 비교용 정규화.
 * - `scripts/html-to-cell-placeholders.mjs` 의 normalizeForCompare 와 동일 규칙
 * - multiline 셀은 줄바꿈·`<br>` 를 공백으로 접어 한 덩어리로 비교
 */

/** 앞뒤 공백·CR 제거 */
export function normalizeValue(value: string | null | undefined): string {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
}

/** 비교용: 공백·줄바꿈·br 태그를 단일 공백으로 접고 소문자화 */
export function normalizeForCompare(value: string | null | undefined): string {
    return normalizeValue(value)
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/\s+/g, " ")
        .toLowerCase();
}

/** ignoreValues(N/A 등)에 해당하면 true */
export function shouldIgnoreValue(value: string, ignoreValues: string[]): boolean {
    const normalized = normalizeForCompare(value);
    return ignoreValues.some((ignored) => normalizeForCompare(ignored) === normalized);
}
