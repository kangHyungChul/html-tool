/**
 * Business Area QA 대상 LG 페이지 URL 빌더.
 * - Business Area 컴포넌트는 `/business/about-lg-business/` 페이지에 어셈블됨
 * - `/business` 홈에는 해당 컴포넌트가 없음
 */

/** About LG Business 페이지 경로 (locale 세그먼트 뒤에 붙음) */
export const QA_ABOUT_LG_BUSINESS_PATH = "/business/about-lg-business/";

/** 비교군(글로벌) 기본 QA URL */
export const QA_DEFAULT_BASELINE_URL = "https://www.lg.com/global/business/about-lg-business/";

/**
 * locale-map 키로 QA 검증 페이지 URL 생성.
 * @param localeKey 예: global, uk, ca_en
 */
export function buildQaTargetPageUrl(localeKey: string): string {
    const seg = localeKey.trim().toLowerCase() || "global";
    return `https://www.lg.com/${seg}${QA_ABOUT_LG_BUSINESS_PATH}`;
}
