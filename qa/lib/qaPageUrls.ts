/**
 * Business Area QA 대상 LG 페이지 URL 빌더.
 * 설정은 `qa/qa.config.ts` → `page` 섹션.
 */
import { getQaConfig, type QaConfig } from "./qaConfig";

/** @deprecated `getDefaultBaselineUrl()` 사용 */
export const QA_ABOUT_LG_BUSINESS_PATH = "/business/about-lg-business/";

/** @deprecated `getDefaultBaselineUrl()` 사용 */
export const QA_DEFAULT_BASELINE_URL = "https://www.lg.com/global/business/about-lg-business/";

export function getDefaultBaselineUrl(config?: QaConfig): string {
    return (config ?? getQaConfig()).page.defaultBaselineUrl;
}

export function buildQaTargetPageUrl(localeKey: string, config?: QaConfig): string {
    const c = config ?? getQaConfig();
    const seg = localeKey.trim().toLowerCase() || "global";
    const path = c.page.aboutLgBusinessPath.startsWith("/")
        ? c.page.aboutLgBusinessPath
        : `/${c.page.aboutLgBusinessPath}`;
    return `${c.page.lgComOrigin}/${seg}${path}`;
}
