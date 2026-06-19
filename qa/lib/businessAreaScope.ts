import type { Page, Locator } from "playwright";

import { getQaConfig, type QaConfig } from "./qaConfig";
import type { QaProgressEvent } from "./types";
import { assertPageLoadOk } from "./playwrightBrowser";

/**
 * Business Area 컴포넌트 탐색용 후보 셀렉터 (legacy `waitForBusinessAreaScope` 전용).
 * 번역·링크 QA 루트는 `config.page.businessAreaRootSelector` 만 사용한다.
 */
export const BUSINESS_AREA_SCOPE_SELECTORS = [
    ".business-area",
    ".business-area__container",
    '[class*="business-area"]',
    '[data-hq-panel-id="eco-solution"]',
    '[data-hq-panel-id]',
    '[data-hq-business-tab-strip="1"]',
    '[data-hq-business-tab-strip]',
    ".c-wrapper.ST0002",
    "#eco-solution",
    "#tab-eco-solution",
] as const;

/** @deprecated `getQaConfig().page.businessAreaRootSelector` 사용 */
export const BUSINESS_AREA_SCOPE_SELECTOR = ".business-area";

function cfg(config?: QaConfig): QaConfig {
    return config ?? getQaConfig();
}

/** 쿠키·동의 배너가 Business Area 탐색을 가리는 경우 닫기 시도 */
async function dismissBlockingOverlays(page: Page, config?: QaConfig): Promise<void> {
    const { cookieBannerSelectors } = cfg(config).page;
    const { cookieBannerVisibleMs, cookieBannerClickMs, cookieBannerPostClickMs } = cfg(config).timeouts;

    for (const selector of cookieBannerSelectors) {
        const btn = page.locator(selector).first();
        const visible = await btn.isVisible({ timeout: cookieBannerVisibleMs }).catch(() => false);
        if (visible) {
            await btn.click({ timeout: cookieBannerClickMs }).catch(() => undefined);
            await page.waitForTimeout(cookieBannerPostClickMs);
            break;
        }
    }
}

/** lazy-load·AEM hydration 유도를 위해 페이지를 아래로 스크롤 */
export async function scrollPageForLazyContent(page: Page, config?: QaConfig): Promise<void> {
    const scrollPauseMs = cfg(config).timeouts.scrollPauseMs;
    await page.evaluate(async (pauseMs) => {
        const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
        const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        for (let y = 0; y < maxScroll; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, pauseMs));
        }
        window.scrollTo(0, 0);
    }, scrollPauseMs);
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        const err = new Error("QA가 사용자에 의해 중단되었습니다.");
        err.name = "AbortError";
        throw err;
    }
}

/** AbortSignal 로 대기를 끊을 수 있는 sleep */
export async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (ms <= 0) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            cleanup();
            const err = new Error("QA가 사용자에 의해 중단되었습니다.");
            err.name = "AbortError";
            reject(err);
        };
        const cleanup = () => {
            clearTimeout(timer);
            if (signal) {
                signal.removeEventListener("abort", onAbort);
            }
        };
        if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
        }
    });
    throwIfAborted(signal);
}

export async function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    if (!signal) {
        return promise;
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            const err = new Error("QA가 사용자에 의해 중단되었습니다.");
            err.name = "AbortError";
            reject(err);
        };
        if (signal.aborted) {
            onAbort();
            return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        promise
            .then((value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            })
            .catch((err) => {
                signal.removeEventListener("abort", onAbort);
                reject(err);
            });
    });
}

export async function findBusinessAreaScope(page: Page): Promise<{ selector: string; locator: Locator } | null> {
    for (const selector of BUSINESS_AREA_SCOPE_SELECTORS) {
        const locator = page.locator(selector).first();
        const count = await locator.count();
        if (count > 0) {
            return { selector, locator };
        }
    }
    return null;
}

async function waitForPrimaryBusinessAreaAttached(
    page: Page,
    rootSelector: string,
    timeoutMs: number,
): Promise<boolean> {
    try {
        await page.waitForSelector(rootSelector, {
            state: "attached",
            timeout: timeoutMs,
        });
        return true;
    } catch {
        return false;
    }
}

export async function waitForBusinessAreaScope(
    page: Page,
    options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
        onProgress?: (partial: Pick<QaProgressEvent, "message">) => void;
        config?: QaConfig;
    },
): Promise<{ selector: string; locator: Locator }> {
    const config = cfg(options?.config);
    const timeoutMs = options?.timeoutMs ?? config.timeouts.businessAreaScopeDefaultMs;
    const started = Date.now();
    const emit = (message: string) => options?.onProgress?.({ message });

    emit(`Business Area 영역 탐색 중… (${config.page.businessAreaRootSelector})`);

    await dismissBlockingOverlays(page, config);
    await waitForPrimaryBusinessAreaAttached(
        page,
        config.page.businessAreaRootSelector,
        Math.min(config.timeouts.primaryAttachedWaitCapMs, timeoutMs),
    );

    while (Date.now() - started < timeoutMs) {
        throwIfAborted(options?.signal);

        const found = await findBusinessAreaScope(page);
        if (found) {
            emit(`Business Area 발견: ${found.selector}`);
            return found;
        }

        const elapsed = Math.round((Date.now() - started) / 1000);
        emit(`Business Area 대기 중… (${elapsed}s)`);

        await scrollPageForLazyContent(page, config);
        await dismissBlockingOverlays(page, config);
        await abortableDelay(config.timeouts.scopePollIntervalMs, options?.signal);
    }

    throw new Error(
        `Business Area 영역을 찾지 못했습니다 (${timeoutMs / 1000}s 초과). ` +
            `페이지 제목: 「${await page.title()}」. ` +
            `URL·셀렉터(${config.page.businessAreaRootSelector})를 확인하세요.`,
    );
}

export async function getBusinessAreaRootLocator(page: Page, config?: QaConfig): Promise<Locator | null> {
    const rootSelector = cfg(config).page.businessAreaRootSelector;
    const root = page.locator(rootSelector).first();
    if ((await root.count()) === 0) {
        return null;
    }
    return root;
}

export async function waitForBusinessAreaRoot(
    page: Page,
    options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
        onProgress?: (partial: Pick<QaProgressEvent, "message">) => void;
        config?: QaConfig;
    },
): Promise<Locator> {
    const config = cfg(options?.config);
    const rootSelector = config.page.businessAreaRootSelector;
    const timeoutMs = options?.timeoutMs ?? config.timeouts.businessAreaRootMs;
    const started = Date.now();
    const emit = (message: string) => options?.onProgress?.({ message });

    emit(`\`${rootSelector}\` 루트 탐색 중…`);

    await dismissBlockingOverlays(page, config);
    await waitForPrimaryBusinessAreaAttached(
        page,
        rootSelector,
        Math.min(config.timeouts.primaryAttachedWaitCapMs, timeoutMs),
    );

    while (Date.now() - started < timeoutMs) {
        throwIfAborted(options?.signal);

        const root = await getBusinessAreaRootLocator(page, config);
        if (root) {
            emit(`Business Area 루트 발견: ${rootSelector}`);
            return root;
        }

        const elapsed = Math.round((Date.now() - started) / 1000);
        emit(`\`${rootSelector}\` 대기 중… (${elapsed}s)`);

        await scrollPageForLazyContent(page, config);
        await dismissBlockingOverlays(page, config);
        await abortableDelay(config.timeouts.scopePollIntervalMs, options?.signal);
    }

    throw new Error(
        `페이지에서 \`${rootSelector}\` 루트를 찾지 못했습니다 (${timeoutMs / 1000}s 초과). ` +
            `페이지 제목: 「${await page.title()}」. URL·AEM 컴포넌트 마크업을 확인하세요.`,
    );
}

export async function gotoQaTargetPage(
    page: Page,
    url: string,
    signal?: AbortSignal,
    config?: QaConfig,
): Promise<void> {
    const c = cfg(config);
    throwIfAborted(signal);
    const response = await raceWithAbort(
        page.goto(url, {
            waitUntil: c.timeouts.pageGotoWaitUntil,
            timeout: c.timeouts.pageGotoMs,
        }),
        signal,
    );
    assertPageLoadOk(response?.status(), await page.title(), page.url(), c);
    throwIfAborted(signal);
    await dismissBlockingOverlays(page, c);
    await abortableDelay(c.timeouts.postGotoHydrationMs, signal);
}
