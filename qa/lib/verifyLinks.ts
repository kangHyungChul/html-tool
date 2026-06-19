import type { Browser, BrowserContext, Locator, Page } from "playwright";

import { sanitizeLocalePathSegmentForLgUrl } from "./localeUrl";
import { getQaConfig, isLgComHrefByConfig, type QaConfig } from "./qaConfig";

import { raceWithAbort, throwIfAborted } from "./businessAreaScope";
import {
    hrefUsesGlobalSegment,
    hrefUsesLocaleSegment,
    pageLooksLike404,
    resolveAbsoluteHref,
} from "./pageExtractors";
import type { LinkLocaleRuleResult, LinkNavigationResult } from "./types";

function cfg(config?: QaConfig): QaConfig {
    return config ?? getQaConfig();
}

function isLgCom(href: string, config: QaConfig): boolean {
    return isLgComHrefByConfig(href, config);
}

/** DOM `<a href>` 원본 + 페이지 기준 절대 URL */
function resolveLinkHrefs(rawHref: string, pageUrl: string): { href: string; resolvedHref: string } {
    return {
        href: rawHref,
        resolvedHref: resolveAbsoluteHref(rawHref, pageUrl),
    };
}

function linkDisplayFields(
    link: { href: string; linkText: string; targetBlank: boolean; anchorIndex: number },
    pageUrl: string,
): {
    anchorIndex: number;
    href: string;
    resolvedHref: string;
    linkText: string;
    targetBlank: boolean;
} {
    return {
        anchorIndex: link.anchorIndex,
        ...resolveLinkHrefs(link.href, pageUrl),
        linkText: link.linkText,
        targetBlank: link.targetBlank,
    };
}

/**
 * `<a href>` 로케일/global 규칙 검증.
 */
export function verifyLinkLocaleRules(
    links: { href: string; linkText: string; targetBlank: boolean; anchorIndex: number }[],
    pageUrl: string,
    localeKey: string,
    config?: QaConfig,
): LinkLocaleRuleResult[] {
    const c = cfg(config);
    const rules = c.links.rules;
    const seg = sanitizeLocalePathSegmentForLgUrl(localeKey);
    const isGlobalLocale = seg === "global";

    return links.map((link) => {
        const absoluteHref = resolveAbsoluteHref(link.href, pageUrl);
        const fields = linkDisplayFields(link, pageUrl);

        if (!isLgCom(absoluteHref, c)) {
            return {
                status: "skip",
                ...fields,
                expectedPathKind: "other" as const,
                detail: "lg.com 외부·상대 링크 — 경로 규칙 검증 skip",
            };
        }

        if (link.targetBlank) {
            if (!rules.blankTargetMustUseGlobal) {
                return {
                    status: "skip",
                    ...fields,
                    expectedPathKind: "global" as const,
                    detail: "blankTargetMustUseGlobal 비활성 — skip",
                };
            }
            const usesGlobal = hrefUsesGlobalSegment(absoluteHref);
            return {
                status: usesGlobal ? "pass" : "fail",
                ...fields,
                expectedPathKind: "global" as const,
                detail: usesGlobal
                    ? undefined
                    : "target=_blank 링크는 www.lg.com/global/ 경로를 유지해야 합니다.",
            };
        }

        if (isGlobalLocale) {
            const usesGlobal = hrefUsesGlobalSegment(absoluteHref);
            if (!usesGlobal && rules.globalPageNonGlobalLinks === "skip") {
                return {
                    status: "skip",
                    ...fields,
                    expectedPathKind: "global" as const,
                    detail: "global 페이지 non-global 링크 — skip",
                };
            }
            const mismatchStatus =
                rules.globalPageNonGlobalLinks === "fail"
                    ? "fail"
                    : rules.globalPageNonGlobalLinks === "warn"
                      ? "warn"
                      : "skip";
            return {
                status: usesGlobal ? "pass" : mismatchStatus,
                ...fields,
                expectedPathKind: "global" as const,
                detail: usesGlobal ? undefined : "글로벌 페이지 링크가 global 세그먼트가 아닙니다.",
            };
        }

        if (!rules.sameTabMustUseLocale) {
            return {
                status: "skip",
                ...fields,
                expectedPathKind: "locale" as const,
                detail: "sameTabMustUseLocale 비활성 — skip",
            };
        }

        const usesLocale = hrefUsesLocaleSegment(absoluteHref, seg);
        const stillGlobal = hrefUsesGlobalSegment(absoluteHref);

        return {
            status: usesLocale && !stillGlobal ? "pass" : "fail",
            ...fields,
            expectedPathKind: "locale" as const,
            detail:
                usesLocale && !stillGlobal
                    ? undefined
                    : `로케일(${seg}) 페이지 링크는 www.lg.com/${seg}/ 로 치환되어야 합니다.`,
        };
    });
}

export async function verifyLinkNavigation(
    browser: Browser,
    mainPage: Page,
    links: {
        href: string;
        linkText: string;
        targetBlank: boolean;
        anchorIndex: number;
        locator: Locator;
    }[],
    pageUrl: string,
    options?: {
        signal?: AbortSignal;
        onLinkProgress?: (current: number, total: number) => void;
        config?: QaConfig;
    },
): Promise<LinkNavigationResult[]> {
    void browser;
    const c = cfg(options?.config);
    const context: BrowserContext = mainPage.context();
    const results: LinkNavigationResult[] = [];

    /** 동일 URL·target 조합은 HTTP/클릭 1회만 수행하고 각 `<a>` 행에 결과 복제 */
    const navCache = new Map<
        string,
        Pick<LinkNavigationResult, "status" | "httpStatus" | "openedNewTab" | "detail">
    >();

    const lgComLinks = links.filter((link) => isLgCom(resolveAbsoluteHref(link.href, pageUrl), c));
    let processed = 0;

    for (const link of links) {
        throwIfAborted(options?.signal);

        const absoluteHref = resolveAbsoluteHref(link.href, pageUrl);
        const fields = linkDisplayFields(link, pageUrl);

        if (!isLgCom(absoluteHref, c)) {
            results.push({
                status: "skip",
                ...fields,
                detail: "lg.com 링크가 아니어서 탐색 검증 skip",
            });
            continue;
        }

        processed += 1;
        options?.onLinkProgress?.(processed, lgComLinks.length);

        const cacheKey = `${absoluteHref}|${link.targetBlank}`;
        const cached = navCache.get(cacheKey);
        if (cached) {
            results.push({
                ...fields,
                ...cached,
                detail: cached.detail ?? "동일 URL — 캐시된 탐색 결과",
            });
            continue;
        }

        let navResult: LinkNavigationResult;
        if (link.targetBlank) {
            navResult = await verifyBlankLinkByClick(mainPage, link, c, options?.signal);
        } else {
            navResult = await verifySameTabLinkByGoto(context, link, absoluteHref, c, options?.signal);
        }

        const cacheEntry = {
            status: navResult.status,
            httpStatus: navResult.httpStatus,
            openedNewTab: navResult.openedNewTab,
            detail: navResult.detail,
        };
        navCache.set(cacheKey, cacheEntry);
        results.push(navResult);
    }

    return results;
}

/**
 * 링크가 hidden tabpanel 안에 있으면 해당 탭을 활성화한다.
 * domPrepare 가 마지막 비즈니스 탭에서 끝난 뒤 다른 탭 링크는 클릭 불가 → 타임아웃 원인.
 */
async function activateTabPanelForLink(
    page: Page,
    locator: Locator,
    config: QaConfig,
): Promise<boolean> {
    const tabPatterns = config.links.navigation.tabLocatorPatterns;

    const activated = await locator
        .evaluate((el, patterns) => {
            let node: Element | null = el;
            while (node) {
                if (node.getAttribute("role") === "tabpanel") {
                    const panelId = node.id;
                    const hidden =
                        node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true";
                    if (!panelId || !hidden) {
                        return false;
                    }
                    for (const pattern of patterns as string[]) {
                        const selector = pattern.replace(/\{panelId\}/g, panelId);
                        const tab = document.querySelector(selector) as HTMLElement | null;
                        if (tab) {
                            tab.click();
                            return true;
                        }
                    }
                    return false;
                }
                node = node.parentElement;
            }
            return false;
        }, tabPatterns)
        .catch(() => false);

    if (activated) {
        await page.waitForTimeout(config.timeouts.prepareInteractionPauseMs);
    }
    return activated;
}

async function verifyBlankLinkByGoto(
    context: BrowserContext,
    link: { href: string; linkText: string; targetBlank: boolean; anchorIndex: number },
    absoluteHref: string,
    config: QaConfig,
    signal?: AbortSignal,
): Promise<LinkNavigationResult> {
    const fields = {
        anchorIndex: link.anchorIndex,
        href: link.href,
        resolvedHref: absoluteHref,
        linkText: link.linkText,
        targetBlank: link.targetBlank,
    };
    const popup = await context.newPage();
    try {
        throwIfAborted(signal);
        const response = await raceWithAbort(
            popup.goto(absoluteHref, {
                waitUntil: config.timeouts.pageGotoWaitUntil,
                timeout: config.timeouts.linkPopupLoadMs,
            }),
            signal,
        );
        const httpStatus = response?.status();
        const is404 = await pageLooksLike404(popup, httpStatus);

        return {
            status: is404 ? "fail" : "pass",
            ...fields,
            openedNewTab: true,
            httpStatus,
            detail: is404
                ? `새 탭 goto — 404 또는 Not Found (HTTP ${httpStatus ?? "?"})`
                : "hidden tabpanel 링크 — 클릭 대신 goto 로 URL 검증",
        };
    } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
            throw err;
        }
        return {
            status: "fail",
            ...fields,
            openedNewTab: false,
            detail: `새 탭 goto 검증 실패: ${err instanceof Error ? err.message : String(err)}`,
        };
    } finally {
        await popup.close().catch(() => undefined);
    }
}

async function verifyBlankLinkByClick(
    mainPage: Page,
    link: { href: string; linkText: string; targetBlank: boolean; anchorIndex: number; locator: Locator },
    config: QaConfig,
    signal?: AbortSignal,
): Promise<LinkNavigationResult> {
    const pageUrl = mainPage.url();
    const absoluteHref = resolveAbsoluteHref(link.href, pageUrl);
    const fields = linkDisplayFields(link, pageUrl);
    const { linkPopupWaitMs, linkClickMs, linkPopupLoadMs, prepareScrollTimeoutMs } = config.timeouts;
    const nav = config.links.navigation;

    try {
        throwIfAborted(signal);

        if (nav.activateTabBeforeBlankClick) {
            await activateTabPanelForLink(mainPage, link.locator, config);
        }

        await link.locator
            .scrollIntoViewIfNeeded({ timeout: prepareScrollTimeoutMs })
            .catch(() => undefined);

        const popupPromise = mainPage.context().waitForEvent("page", { timeout: linkPopupWaitMs });
        await raceWithAbort(link.locator.click({ timeout: linkClickMs }), signal);
        const popup = await raceWithAbort(popupPromise, signal);

        await raceWithAbort(
            popup.waitForLoadState("domcontentloaded", { timeout: linkPopupLoadMs }).catch(() => undefined),
            signal,
        );

        const is404 = await pageLooksLike404(popup);
        await popup.close().catch(() => undefined);

        return {
            status: is404 ? "fail" : "pass",
            ...fields,
            openedNewTab: true,
            detail: is404 ? "새 탭에서 404 또는 Not Found 페이지가 감지되었습니다." : undefined,
        };
    } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
            throw err;
        }

        if (nav.blankClickFallbackGoto) {
            return verifyBlankLinkByGoto(mainPage.context(), link, absoluteHref, config, signal);
        }

        return {
            status: "fail",
            ...fields,
            openedNewTab: false,
            detail: `새 탭 클릭 검증 실패: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function verifySameTabLinkByGoto(
    context: BrowserContext,
    link: { href: string; linkText: string; targetBlank: boolean; anchorIndex: number },
    absoluteHref: string,
    config: QaConfig,
    signal?: AbortSignal,
): Promise<LinkNavigationResult> {
    const fields = {
        anchorIndex: link.anchorIndex,
        href: link.href,
        resolvedHref: absoluteHref,
        linkText: link.linkText,
        targetBlank: link.targetBlank,
    };
    throwIfAborted(signal);
    const testPage = await context.newPage();
    try {
        const response = await raceWithAbort(
            testPage.goto(absoluteHref, {
                waitUntil: config.timeouts.pageGotoWaitUntil,
                timeout: config.timeouts.linkSameTabGotoMs,
            }),
            signal,
        );
        const httpStatus = response?.status();
        const is404 = await pageLooksLike404(testPage, httpStatus);

        return {
            status: is404 ? "fail" : "pass",
            ...fields,
            httpStatus,
            detail: is404
                ? `HTTP ${httpStatus ?? "?"} — 404 또는 Not Found 로 판단`
                : undefined,
        };
    } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
            throw err;
        }
        return {
            status: "fail",
            ...fields,
            detail: `탐색 실패: ${err instanceof Error ? err.message : String(err)}`,
        };
    } finally {
        await testPage.close().catch(() => undefined);
    }
}
