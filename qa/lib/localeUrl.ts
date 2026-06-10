/**
 * LG URL locale 경로 세그먼트 정규화 (html-tool 공유 로직과 동일).
 */
export function sanitizeLocalePathSegmentForLgUrl(raw: string): string {
    const t = raw.trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(t)) {
        return "global";
    }
    return t;
}
