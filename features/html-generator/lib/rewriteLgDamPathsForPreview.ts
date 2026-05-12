/**
 * iframe 미리보기 전용: LG DAM 루트 경로만 프로덕션 도메인으로 바꾼다.
 *
 * 배경:
 * - 템플릿·다운로드 HTML은 CMS 삽입용으로 `/content/dam/...` 루트 상대 경로를 유지한다.
 * - 로컬(dev) `srcDoc`에서는 해당 경로가 localhost 기준이라 이미지·동영상이 404가 난다.
 * - 그래서 **미리보기에 넣는 문자열만** `https://www.lg.com/content/dam/...` 로 바꿔 브라우저가 lg.com에서 받게 한다.
 *
 * 하지 않는 것:
 * - `/fonts/` 등 다른 루트 경로는 변경하지 않는다.
 * - 이미 `https://www.lg.com` 이 앞에 붙은 URL은 `="/content` 패턴이 아니므로 건드리지 않는다.
 */

/** LG 글로벌 사이트 오리진 (트레일링 슬래시 없음) */
export const LG_PREVIEW_ORIGIN = "https://www.lg.com";

/**
 * HTML 문자열 안의 `/content/dam/` 자원 참조를 `https://www.lg.com/content/dam/` 로 치환한다.
 *
 * 지원 패턴(템플릿에서 실제 사용):
 * - 속성: `src`, `href`, `poster`, `srcset` (큰따옴표·작은따옴표)
 * - 인라인 CSS: `url(/content/dam/...)`, `url("/content/dam/...")`, `url('/content/dam/...')`
 */
export function rewriteLgDamPathsForPreview(html: string, origin: string = LG_PREVIEW_ORIGIN): string {
    const base = origin.replace(/\/+$/, "");
    const absContentDam = `${base}/content/dam/`;

    /** 루트 상대 DAM 접두어만 절대 URL로 바꾼다 */
    const fromDam = "/content/dam/";

    let out = html;

    const pairs: [string, string][] = [
        [`src="${fromDam}`, `src="${absContentDam}`],
        [`src='${fromDam}`, `src='${absContentDam}`],
        [`href="${fromDam}`, `href="${absContentDam}`],
        [`href='${fromDam}`, `href='${absContentDam}`],
        [`poster="${fromDam}`, `poster="${absContentDam}`],
        [`poster='${fromDam}`, `poster='${absContentDam}`],
        [`srcset="${fromDam}`, `srcset="${absContentDam}`],
        [`srcset='${fromDam}`, `srcset='${absContentDam}`],
        [`url(${fromDam}`, `url(${absContentDam}`],
        [`url("${fromDam}`, `url("${absContentDam}`],
        [`url('${fromDam}`, `url('${absContentDam}`],
    ];

    for (const [needle, replacement] of pairs) {
        out = out.replaceAll(needle, replacement);
    }

    return out;
}
