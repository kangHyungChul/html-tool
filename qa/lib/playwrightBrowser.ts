import { chromium, type Browser, type BrowserContext, type LaunchOptions } from "playwright";

import { getQaConfig, type QaConfig } from "./qaConfig";

/**
 * Playwright QA용 Browser launch 옵션.
 * - 기본 headless 는 lg.com 에서 403 Access Denied → `.business-area` 탐색 불가
 */
export function getQaBrowserLaunchOptions(config?: QaConfig, overrides?: LaunchOptions): LaunchOptions {
    const c = config ?? getQaConfig();
    return {
        headless: c.browser.headless,
        args: [...c.browser.args],
        ...overrides,
    };
}

/** QA 페이지 탐색용 BrowserContext 생성 */
export async function createQaBrowserContext(browser: Browser, config?: QaConfig): Promise<BrowserContext> {
    const c = config ?? getQaConfig();
    const context = await browser.newContext({
        userAgent: c.browser.userAgent,
        locale: c.browser.locale,
        viewport: { ...c.browser.viewport },
        extraHTTPHeaders: { ...c.browser.extraHTTPHeaders },
    });

    if (c.browser.hideWebdriver) {
        await context.addInitScript(() => {
            Object.defineProperty(navigator, "webdriver", {
                get: () => undefined,
            });
        });
    }

    return context;
}

/** QA용 Chromium 실행 + Context */
export async function launchQaBrowser(config?: QaConfig): Promise<{ browser: Browser; context: BrowserContext }> {
    const c = config ?? getQaConfig();
    const browser = await chromium.launch(getQaBrowserLaunchOptions(c));
    const context = await createQaBrowserContext(browser, c);
    return { browser, context };
}

/** 페이지 로드 후 HTTP 상태 검사 */
export function assertPageLoadOk(
    status: number | undefined,
    pageTitle: string,
    pageUrl: string,
    config?: QaConfig,
): void {
    const c = config ?? getQaConfig();
    if (status !== undefined && status >= c.browser.httpErrorThreshold) {
        throw new Error(
            `페이지 로드 실패 HTTP ${status} (${pageUrl}). ` +
                `제목: 「${pageTitle}」 — lg.com 봇 차단(403) 또는 URL 오류일 수 있습니다.`,
        );
    }
    const deniedRe = new RegExp(c.browser.accessDeniedTitlePattern, "i");
    if (deniedRe.test(pageTitle)) {
        throw new Error(`lg.com Access Denied — 자동화 브라우저가 차단되었습니다. (${pageUrl})`);
    }
}

/** @deprecated `getQaConfig().browser.userAgent` */
export const LG_QA_USER_AGENT = getQaConfig().browser.userAgent;
