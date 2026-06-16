/**
 * LG DAM 에셋 경로 로케일 치환 (이미지·동영상·CSS 등).
 *
 * 대상 경로 패턴: `/content/dam/channelbtb/lgcom/{localeKey}/...`
 * (미리보기 절대 URL `https://www.lg.com/content/dam/...` 도 동일 규칙)
 *
 * Case 1 — `/hq/` 세그먼트 없음 (예: `.../lgcom/global/.../test.jpg`)
 *   → `global` 만 대상 localeKey 로 교체
 *
 * Case 2 — `/hq/` 포함 (예: `.../lgcom/global/hq/.../hq-common-2026.jpg`)
 *   → localeKey 교체 + `/hq/` → `/corp/` + 파일명 접두 `hq` → `corp` (hq-, hq_ 무관)
 *
 * `global` localeKey 이면 치환하지 않음 (템플릿 baseline 유지).
 */
import { sanitizeLocalePathSegmentForLgUrl } from "./rewriteLgComGlobalPathToLocale";

/** DAM lgcom 경로 — optional origin + locale 세그먼트 + 나머지 경로 */
const DAM_LGCOM_PATH_RE =
    /^(https?:\/\/www\.lg\.com)?(\/content\/dam\/channelbtb\/lgcom\/)([a-z0-9_]+)(\/[^?#]*)?([?#].*)?$/i;

/**
 * 파일명(마지막 경로 세그먼트) 선두의 `hq` 단어를 `corp` 로 바꾼다.
 * - `hq-common-2026.jpg` → `corp-common-2026.jpg`
 * - `hq_test.jpg` → `corp_test.jpg`
 * - `hq.jpg` → `corp.jpg`
 */
function replaceHqWordPrefixInFilename(pathAfterLocale: string): string {
    const lastSlash = pathAfterLocale.lastIndexOf("/");
    if (lastSlash === -1) {
        return pathAfterLocale.replace(/^hq(?=[\-_.]|$)/i, "corp");
    }
    const dir = pathAfterLocale.slice(0, lastSlash + 1);
    const filename = pathAfterLocale.slice(lastSlash + 1);
    return dir + filename.replace(/^hq(?=[\-_.]|$)/i, "corp");
}

/**
 * 단일 DAM URL/경로 문자열을 locale 규칙에 맞게 치환한다.
 * @param urlPath 상대(`/content/dam/...`) 또는 절대(`https://www.lg.com/content/dam/...`)
 * @param localePathSegment locale-map 키 (예: `uk`, `global`)
 */
export function rewriteDamAssetUrlForLocale(urlPath: string, localePathSegment: string): string {
    const trimmed = urlPath.trim();
    if (!trimmed) {
        return urlPath;
    }

    const targetLocale = sanitizeLocalePathSegmentForLgUrl(localePathSegment);
    if (targetLocale === "global") {
        return urlPath;
    }

    const match = trimmed.match(DAM_LGCOM_PATH_RE);
    if (!match) {
        return urlPath;
    }

    const origin = match[1] ?? "";
    const lgcomPrefix = match[2];
    const restPath = match[4] ?? "";
    const suffix = match[5] ?? "";

    if (!restPath) {
        return urlPath;
    }

    /** Case 2: locale 직후 `/hq/` 디렉터리 */
    if (/^\/hq\//i.test(restPath)) {
        const afterCorp = restPath.replace(/^\/hq\//i, "/corp/");
        const withFilename = replaceHqWordPrefixInFilename(afterCorp);
        return `${origin}${lgcomPrefix}${targetLocale}${withFilename}${suffix}`;
    }

    /** Case 1: locale 세그먼트만 교체 */
    return `${origin}${lgcomPrefix}${targetLocale}${restPath}${suffix}`;
}

/** srcset 값 — `url 1x, url 2x` 형태에서 URL 토큰만 치환 */
function rewriteSrcsetValueForLocale(srcset: string, localePathSegment: string): string {
    return srcset
        .split(",")
        .map((candidate) => {
            const part = candidate.trim();
            if (!part) {
                return candidate;
            }
            const spaceIdx = part.search(/\s/);
            if (spaceIdx === -1) {
                return rewriteDamAssetUrlForLocale(part, localePathSegment);
            }
            const url = part.slice(0, spaceIdx);
            const descriptor = part.slice(spaceIdx);
            return rewriteDamAssetUrlForLocale(url, localePathSegment) + descriptor;
        })
        .join(", ");
}

/** 속성 값이 DAM lgcom 경로면 치환 */
function rewriteAttributeValueForLocale(value: string, localePathSegment: string): string {
    if (!/\/content\/dam\/channelbtb\/lgcom\//i.test(value)) {
        return value;
    }
    return rewriteDamAssetUrlForLocale(value, localePathSegment);
}

/**
 * HTML 문자열 안의 DAM 에셋 URL 을 locale 규칙으로 치환한다.
 * - `src`, `href`, `poster`, `srcset`, CSS `url(...)`
 * - `<a href>` 페이지 링크는 `rewriteLgComGlobalPathToLocale` 담당 — DAM 경로만 처리
 */
export function rewriteLgDamAssetPathsForLocale(html: string, localePathSegment: string): string {
    if (!html) {
        return html;
    }

    const targetLocale = sanitizeLocalePathSegmentForLgUrl(localePathSegment);
    if (targetLocale === "global") {
        return html;
    }

    let out = html;

    const attrPatterns: Array<{ open: string; close: string }> = [
        { open: 'src="', close: '"' },
        { open: "src='", close: "'" },
        { open: 'href="', close: '"' },
        { open: "href='", close: "'" },
        { open: 'poster="', close: '"' },
        { open: "poster='", close: "'" },
        { open: 'srcset="', close: '"' },
        { open: "srcset='", close: "'" },
    ];

    for (const { open, close } of attrPatterns) {
        const isSrcset = open.startsWith("srcset");
        out = out.replace(
            new RegExp(`${escapeRegExp(open)}([^${close === '"' ? "'\"" : "'"}]*)${escapeRegExp(close)}`, "gi"),
            (full, value: string) => {
                if (!/\/content\/dam\/channelbtb\/lgcom\//i.test(value)) {
                    return full;
                }
                const next = isSrcset
                    ? rewriteSrcsetValueForLocale(value, localePathSegment)
                    : rewriteAttributeValueForLocale(value, localePathSegment);
                return next === value ? full : `${open}${next}${close}`;
            },
        );
    }

    /** CSS `url(/content/dam/...)` */
    out = out.replace(
        /url\(\s*(['"]?)(\/content\/dam\/channelbtb\/lgcom\/[^)'"]+)\1\s*\)/gi,
        (full, quote: string, path: string) => {
            const next = rewriteDamAssetUrlForLocale(path, localePathSegment);
            return next === path ? full : `url(${quote}${next}${quote})`;
        },
    );

    /** 절대 URL — 미리보기 등에서 origin 이 붙은 뒤에도 locale 치환 가능 */
    out = out.replace(
        /url\(\s*(['"]?)(https:\/\/www\.lg\.com\/content\/dam\/channelbtb\/lgcom\/[^)'"]+)\1\s*\)/gi,
        (full, quote: string, path: string) => {
            const next = rewriteDamAssetUrlForLocale(path, localePathSegment);
            return next === path ? full : `url(${quote}${next}${quote})`;
        },
    );

    return out;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
