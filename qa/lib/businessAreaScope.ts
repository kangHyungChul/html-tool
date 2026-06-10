import type { Page, Locator } from "playwright";

import type { QaProgressEvent } from "./types";
import { assertPageLoadOk } from "./playwrightBrowser";

/**
 * Business Area 컴포넌트 탐색용 후보 셀렉터 (우선순위 순).
 * - AEM 실 페이지 루트: `<div class="business-area">` (Inspect 기준)
 * - 탭 패널이 hidden 이라 `visible` 대기는 쓰지 않고 `attached`(DOM 존재)만 확인
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

/** QA·DOM 검증 기본 스코프 — AEM 어셈블 페이지의 `.business-area` 루트 */
export const BUSINESS_AREA_SCOPE_SELECTOR = ".business-area";

/** 쿠키·동의 배너가 Business Area 탐색을 가리는 경우 닫기 시도 */
async function dismissBlockingOverlays(page: Page): Promise<void> {
    const acceptSelectors = [
        "#onetrust-accept-btn-handler",
        'button:has-text("Accept All")',
        'button:has-text("Accept all")',
        'button:has-text("Accept")',
        'button:has-text("Agree")',
        'button:has-text("I Agree")',
        ".cmp-button--accept-all",
    ];

    for (const selector of acceptSelectors) {
        const btn = page.locator(selector).first();
        const visible = await btn.isVisible({ timeout: 800 }).catch(() => false);
        if (visible) {
            await btn.click({ timeout: 3000 }).catch(() => undefined);
            await page.waitForTimeout(400);
            break;
        }
    }
}

/** lazy-load·AEM hydration 유도를 위해 페이지를 아래로 스크롤 */
async function scrollPageForLazyContent(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
        const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        for (let y = 0; y < maxScroll; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
    });
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        const err = new Error("QA가 사용자에 의해 중단되었습니다.");
        err.name = "AbortError";
        throw err;
    }
}

/**
 * 페이지에서 Business Area 루트 Locator 를 찾는다 (attached 기준, visible 불필요).
 * @returns 매칭된 셀렉터 문자열 + locator, 없으면 null
 */
export async function findBusinessAreaScope(page: Page): Promise<{ selector: string; locator: Locator } | null> {
    for (const selector of BUSINESS_AREA_SCOPE_SELECTORS) {
        const locator = page.locator(selector).first();
        /** `count()` — hidden·sticky 요소도 DOM 에 있으면 매칭 */
        const count = await locator.count();
        if (count > 0) {
            return { selector, locator };
        }
    }
    return null;
}

/**
 * `.business-area` 가 DOM 에 붙을 때까지 짧게 대기 (폴링 루프 전 1차 시도).
 * `state: 'attached'` — sticky·hidden 이어도 OK.
 */
async function waitForPrimaryBusinessAreaAttached(page: Page, timeoutMs: number): Promise<boolean> {
    try {
        await page.waitForSelector(BUSINESS_AREA_SCOPE_SELECTOR, {
            state: "attached",
            timeout: timeoutMs,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Business Area 영역이 DOM 에 붙을 때까지 대기한다.
 * - `visible` 이 아닌 `attached` — 숨겨진 탭 패널도 인정
 * - 스크롤·쿠키 배너 닫기·여러 셀렉터 폴링
 */
export async function waitForBusinessAreaScope(
    page: Page,
    options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
        onProgress?: (partial: Pick<QaProgressEvent, "message">) => void;
    },
): Promise<{ selector: string; locator: Locator }> {
    const timeoutMs = options?.timeoutMs ?? 90_000;
    const started = Date.now();
    const emit = (message: string) => options?.onProgress?.({ message });

    emit("Business Area 영역 탐색 중… (.business-area)");

    await dismissBlockingOverlays(page);

    /** 1차: Playwright attached 대기 (visible 아님) */
    await waitForPrimaryBusinessAreaAttached(page, Math.min(15_000, timeoutMs));

    while (Date.now() - started < timeoutMs) {
        throwIfAborted(options?.signal);

        const found = await findBusinessAreaScope(page);
        if (found) {
            emit(`Business Area 발견: ${found.selector}`);
            return found;
        }

        const elapsed = Math.round((Date.now() - started) / 1000);
        emit(`Business Area 대기 중… (${elapsed}s)`);

        await scrollPageForLazyContent(page);
        await dismissBlockingOverlays(page);
        await page.waitForTimeout(1500);
    }

    throw new Error(
        `Business Area 영역을 찾지 못했습니다 (${timeoutMs / 1000}s 초과). ` +
            `페이지 제목: 「${await page.title()}」. ` +
            `URL·셀렉터(.business-area)를 확인하세요. lg.com 403 차단 시 브라우저 설정을 점검합니다.`,
    );
}

/** QA 페이지 로드 — domcontentloaded 우선(lg.com networkidle 은 수 분 걸릴 수 있음), 403 등 즉시 실패 */
export async function gotoQaTargetPage(page: Page, url: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    assertPageLoadOk(response?.status(), await page.title(), page.url());
    throwIfAborted(signal);
    await dismissBlockingOverlays(page);
    /** AEM hydration·lazy 컴포넌트 여유 */
    await page.waitForTimeout(2000);
}
