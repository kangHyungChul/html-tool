import { chromium, type Browser, type BrowserContext, type LaunchOptions } from "playwright";

/** LG.com Akamai 봇 차단 우회용 Chromium User-Agent */
export const LG_QA_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Playwright QA용 Browser launch 옵션.
 * - 기본 headless 는 lg.com 에서 403 Access Denied → `.business-area` 탐색 불가
 * - AutomationControlled 비활성화·webdriver 숨김·브라우저 UA/헤더로 200 응답 확보
 */
export function getQaBrowserLaunchOptions(overrides?: LaunchOptions): LaunchOptions {
    return {
        headless: true,
        args: [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-sandbox",
        ],
        ...overrides,
    };
}

/**
 * QA 페이지 탐색용 BrowserContext 생성.
 * - `navigator.webdriver` 제거
 * - lg.com 이 기대하는 Chrome 클라이언트 힌트 헤더
 */
export async function createQaBrowserContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
        userAgent: LG_QA_USER_AGENT,
        locale: "en-US",
        viewport: { width: 1920, height: 1080 },
        extraHTTPHeaders: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Upgrade-Insecure-Requests": "1",
        },
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
        });
    });

    return context;
}

/** QA용 Chromium 실행 + Context 까지 한 번에 */
export async function launchQaBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
    const browser = await chromium.launch(getQaBrowserLaunchOptions());
    const context = await createQaBrowserContext(browser);
    return { browser, context };
}

/**
 * 페이지 로드 후 HTTP 상태 검사 — 403 등이면 즉시 명확한 오류
 */
export function assertPageLoadOk(status: number | undefined, pageTitle: string, pageUrl: string): void {
    if (status !== undefined && status >= 400) {
        throw new Error(
            `페이지 로드 실패 HTTP ${status} (${pageUrl}). ` +
                `제목: 「${pageTitle}」 — lg.com 봇 차단(403) 또는 URL 오류일 수 있습니다.`,
        );
    }
    if (/access denied/i.test(pageTitle)) {
        throw new Error(
            `lg.com Access Denied — 자동화 브라우저가 차단되었습니다. (${pageUrl})`,
        );
    }
}
