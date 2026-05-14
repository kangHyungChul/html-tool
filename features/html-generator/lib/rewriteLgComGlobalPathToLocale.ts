/**
 * 시트(워크 탭)별로 생성되는 HTML 안에서, **`href` 속성 값**에 한해
 * `https://www.lg.com/global/...` 형태의 경로 세그먼트 `global` 을
 * `locale-map.json` 키와 동일한 세그먼트(예: `uk`, `ca_en`)로 바꾼다.
 *
 * 배경:
 * - 템플릿은 글로벌 사이트 기준으로 `.../global/...` 링크가 많다.
 * - `src`, 인라인 스크립트, 본문 텍스트 등 **href 밖**에 동일 문자열이 있어도 건드리지 않는다.
 *
 * 하지 않는 것:
 * - `data-href`, `xlink:href` 등 `href` 이외 속성
 * - 따옴표 없는 `href=...` (이 템플릿은 따옴표 사용 전제)
 * - ISO 국가코드가 아닌 **로케일 맵 키**로만 경로를 바꾼다(`sanitizeLocalePathSegmentForLgUrl` 참고).
 * - `/content/dam/` DAM 루트 상대 경로(미리보기 전용 치환은 별도 모듈).
 */

/** `href` 값 문자열 안에서만 `www.lg.com/global/` → `www.lg.com/{seg}/` (스킴별로 순차 적용, 대소문자 무시) */
function replaceLgGlobalInsideHrefValue(urlValue: string, seg: string): string {
    return (
        urlValue
            /** `https://www.lg.com/global/` — 가장 흔한 케이스 */
            .replace(/^(\s*)(https:\/\/www\.lg\.com\/)global(\/)/i, `$1$2${seg}$3`)
            /** `http://www.lg.com/global/` */
            .replace(/^(\s*)(http:\/\/www\.lg\.com\/)global(\/)/i, `$1$2${seg}$3`)
            /** `//www.lg.com/global/` 프로토콜 상대 */
            .replace(/^(\s*)(\/\/www\.lg\.com\/)global(\/)/i, `$1$2${seg}$3`)
    );
}

/**
 * URL 경로에 넣을 세그먼트 문자열을 안전하게 만든다.
 * - 허용: 소문자 영숫자·밑줄(`locale-map.json` 키 규칙과 동일)
 * - 그 외·빈 문자열 → `global` (치환 없음과 동일한 효과를 내도록 호출부에서도 `global` 이면 스킵 가능)
 */
export function sanitizeLocalePathSegmentForLgUrl(raw: string): string {
    const t = raw.trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(t)) {
        return "global";
    }
    return t;
}

/**
 * HTML 안의 **따옴표로 감싼 `href` 값**만 스캔해, 값이 LG 글로벌 URL이면 로케일 세그먼트로 바꾼다.
 *
 * @param html 원본 HTML
 * @param localePathSegment `resolveLocaleMapKeyForWorkTab` 등과 동일한 키(예: `uk`, `global`)
 */
export function rewriteLgComGlobalPathToLocale(html: string, localePathSegment: string): string {
    if (!html) {
        return html;
    }

    const seg = sanitizeLocalePathSegmentForLgUrl(localePathSegment);
    /** `global` 키면 URL이 이미 글로벌 경로와 일치하므로 속성을 건드릴 필요 없음 */
    if (seg === "global") {
        return html;
    }

    /**
     * `href="..."` — 값 안에 `"` 가 들어가는 경우는 이 도구 템플릿 범위 밖이므로 `[^"]*` 로 충분하다.
     * 전체 일치를 바꿀 때 원문과 동일하면 할당 비용을 줄이기 위해 그대로 둔다.
     */
    const withDoubleQuotes = html.replace(/\bhref\s*=\s*"([^"]*)"/gi, (full, urlValue: string) => {
        const next = replaceLgGlobalInsideHrefValue(urlValue, seg);
        return next === urlValue ? full : `href="${next}"`;
    });

    /** `href='...'` — 작은따옴표 값에 `'` 가 포함된 URL은 드물어 동일하게 단순 패턴 사용 */
    return withDoubleQuotes.replace(/\bhref\s*=\s*'([^']*)'/gi, (full, urlValue: string) => {
        const next = replaceLgGlobalInsideHrefValue(urlValue, seg);
        return next === urlValue ? full : `href='${next}'`;
    });
}
