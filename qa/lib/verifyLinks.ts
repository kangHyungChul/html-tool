import type { Browser, BrowserContext, Page } from "playwright";

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

/**
 * `<a href>` 로케일/global 규칙 검증.
 */
export function verifyLinkLocaleRules(
    links: { href: string; linkText: string; targetBlank: boolean }[],
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

        if (!isLgCom(absoluteHref, c)) {
            return {
                status: "skip",
                href: absoluteHref,
                linkText: link.linkText,
                targetBlank: link.targetBlank,
                expectedPathKind: "other",
                detail: "lg.com 외부·상대 링크 — 경로 규칙 검증 skip",
            };
        }

        if (link.targetBlank) {
            if (!rules.blankTargetMustUseGlobal) {
                return {
                    status: "skip",
                    href: absoluteHref,
                    linkText: link.linkText,
                    targetBlank: true,
                    expectedPathKind: "global",
                    detail: "blankTargetMustUseGlobal 비활성 — skip",
                };
            }
            const usesGlobal = hrefUsesGlobalSegment(absoluteHref);
            return {
                status: usesGlobal ? "pass" : "fail",
                href: absoluteHref,
                linkText: link.linkText,
                targetBlank: true,
                expectedPathKind: "global",
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
                    href: absoluteHref,
                    linkText: link.linkText,
                    targetBlank: false,
                    expectedPathKind: "global",
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
                href: absoluteHref,
                linkText: link.linkText,
                targetBlank: false,
                expectedPathKind: "global",
                detail: usesGlobal ? undefined : "글로벌 페이지 링크가 global 세그먼트가 아닙니다.",
            };
        }

        if (!rules.sameTabMustUseLocale) {
            return {
                status: "skip",
                href: absoluteHref,
                linkText: link.linkText,
                targetBlank: false,
                expectedPathKind: "locale",
                detail: "sameTabMustUseLocale 비활성 — skip",
            };
        }

        const usesLocale = hrefUsesLocaleSegment(absoluteHref, seg);
        const stillGlobal = hrefUsesGlobalSegment(absoluteHref);

        return {
            status: usesLocale && !stillGlobal ? "pass" : "fail",
            href: absoluteHref,
            linkText: link.linkText,
            targetBlank: false,
            expectedPathKind: "locale",
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
    links: { href: string; linkText: string; targetBlank: boolean; locator: import("playwright").Locator }[],
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
    const seenHref = new Set<string>();

    const navigable = links.filter((link) => isLgCom(resolveAbsoluteHref(link.href, pageUrl), c));
    let processed = 0;

    for (const link of links) {
        throwIfAborted(options?.signal);

        const absoluteHref = resolveAbsoluteHref(link.href, pageUrl);

        if (!isLgCom(absoluteHref, c)) {
            results.push({
                status: "skip",
                href: absoluteHref,
                linkText: link.linkText,
                targetBlank: link.targetBlank,
                detail: "lg.com 링크가 아니어서 탐색 검증 skip",
            });
            continue;
        }

        const dedupeKey = `${absoluteHref}|${link.targetBlank}`;
        if (seenHref.has(dedupeKey)) {
            results.push({
                status: "skip",
                href: absoluteHref,
                linkText: link.linkText,
                targetBlank: link.targetBlank,
                detail: "동일 href — 이미 검증함",
            });
            continue;
        }
        seenHref.add(dedupeKey);

        if (link.targetBlank) {
            const popupResult = await verifyBlankLinkByClick(mainPage, link, c, options?.signal);
            results.push(popupResult);
        } else {
            const gotoResult = await verifySameTabLinkByGoto(context, link, absoluteHref, c, options?.signal);
            results.push(gotoResult);
        }

        processed += 1;
        options?.onLinkProgress?.(processed, navigable.length);
    }

    return results;
}

async function verifyBlankLinkByClick(
    mainPage: Page,
    link: { href: string; linkText: string; targetBlank: boolean; locator: import("playwright").Locator },
    config: QaConfig,
    signal?: AbortSignal,
): Promise<LinkNavigationResult> {
    const pageUrl = mainPage.url();
    const absoluteHref = resolveAbsoluteHref(link.href, pageUrl);
    const { linkPopupWaitMs, linkClickMs, linkPopupLoadMs } = config.timeouts;

    try {
        throwIfAborted(signal);
        await link.locator.scrollIntoViewIfNeeded().catch(() => undefined);

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
            href: absoluteHref,
            linkText: link.linkText,
            targetBlank: true,
            openedNewTab: true,
            detail: is404 ? "새 탭에서 404 또는 Not Found 페이지가 감지되었습니다." : undefined,
        };
    } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
            throw err;
        }
        return {
            status: "fail",
            href: absoluteHref,
            linkText: link.linkText,
            targetBlank: true,
            openedNewTab: false,
            detail: `새 탭 클릭 검증 실패: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function verifySameTabLinkByGoto(
    context: BrowserContext,
    link: { href: string; linkText: string; targetBlank: boolean },
    absoluteHref: string,
    config: QaConfig,
    signal?: AbortSignal,
): Promise<LinkNavigationResult> {
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
            href: absoluteHref,
            linkText: link.linkText,
            targetBlank: false,
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
            href: absoluteHref,
            linkText: link.linkText,
            targetBlank: false,
            detail: `탐색 실패: ${err instanceof Error ? err.message : String(err)}`,
        };
    } finally {
        await testPage.close().catch(() => undefined);
    }
}
