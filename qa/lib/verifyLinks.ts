import type { Browser, BrowserContext, Page } from "playwright";

import { sanitizeLocalePathSegmentForLgUrl } from "./localeUrl";

import { throwIfAborted } from "./businessAreaScope";
import {
    hrefUsesGlobalSegment,
    hrefUsesLocaleSegment,
    isLgComHref,
    pageLooksLike404,
    resolveAbsoluteHref,
} from "./pageExtractors";
import type { LinkLocaleRuleResult, LinkNavigationResult } from "./types";

/**
 * `<a href>` 로케일/global 규칙 검증.
 * - `target="_blank"` → global 경로 유지 (rewriteLgComGlobalPathToLocale 과 동일)
 * - 그 외 lg.com 링크 → locale 세그먼트 사용
 */
export function verifyLinkLocaleRules(
    links: { href: string; linkText: string; targetBlank: boolean }[],
    pageUrl: string,
    localeKey: string,
): LinkLocaleRuleResult[] {
    const seg = sanitizeLocalePathSegmentForLgUrl(localeKey);
    const isGlobalLocale = seg === "global";

    return links.map((link) => {
        const absoluteHref = resolveAbsoluteHref(link.href, pageUrl);

        if (!isLgComHref(absoluteHref)) {
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
            return {
                status: usesGlobal ? "pass" : "warn",
                href: absoluteHref,
                linkText: link.linkText,
                targetBlank: false,
                expectedPathKind: "global",
                detail: usesGlobal ? undefined : "글로벌 페이지 링크가 global 세그먼트가 아닙니다.",
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

/**
 * 링크 클릭·탐색 검증 (깊이 B).
 * - target=_blank: 실제 클릭 → popup 새 탭 + 404 검사
 * - 동일 탭: 별도 Page 에 goto (메인 페이지 상태 유지) + 404 검사
 */
export async function verifyLinkNavigation(
    browser: Browser,
    mainPage: Page,
    links: { href: string; linkText: string; targetBlank: boolean; locator: import("playwright").Locator }[],
    pageUrl: string,
    options?: {
        signal?: AbortSignal;
        onLinkProgress?: (current: number, total: number) => void;
    },
): Promise<LinkNavigationResult[]> {
    void browser;
    const context: BrowserContext = mainPage.context();
    const results: LinkNavigationResult[] = [];
    const seenHref = new Set<string>();

    const navigable = links.filter((link) => isLgComHref(resolveAbsoluteHref(link.href, pageUrl)));
    let processed = 0;

    for (const link of links) {
        throwIfAborted(options?.signal);

        const absoluteHref = resolveAbsoluteHref(link.href, pageUrl);

        if (!isLgComHref(absoluteHref)) {
            results.push({
                status: "skip",
                href: absoluteHref,
                linkText: link.linkText,
                targetBlank: link.targetBlank,
                detail: "lg.com 링크가 아니어서 탐색 검증 skip",
            });
            continue;
        }

        /** 동일 href 중복 클릭 방지 */
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
            const popupResult = await verifyBlankLinkByClick(mainPage, link, options?.signal);
            results.push(popupResult);
        } else {
            const gotoResult = await verifySameTabLinkByGoto(context, link, absoluteHref, options?.signal);
            results.push(gotoResult);
        }

        processed += 1;
        options?.onLinkProgress?.(processed, navigable.length);
    }

    return results;
}

/** target=_blank 링크: Playwright 클릭 → popup 수신 → 404 검사 */
async function verifyBlankLinkByClick(
    mainPage: Page,
    link: { href: string; linkText: string; targetBlank: boolean; locator: import("playwright").Locator },
    signal?: AbortSignal,
): Promise<LinkNavigationResult> {
    const pageUrl = mainPage.url();
    const absoluteHref = resolveAbsoluteHref(link.href, pageUrl);

    try {
        throwIfAborted(signal);
        await link.locator.scrollIntoViewIfNeeded().catch(() => undefined);

        const popupPromise = mainPage.context().waitForEvent("page", { timeout: 15000 });
        await link.locator.click({ timeout: 10000 });
        const popup = await popupPromise;

        await popup.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => undefined);

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

/** 동일 탭 링크: 새 Page 에 goto — 메인 Business Area 페이지 상태 보존 */
async function verifySameTabLinkByGoto(
    context: BrowserContext,
    link: { href: string; linkText: string; targetBlank: boolean },
    absoluteHref: string,
    signal?: AbortSignal,
): Promise<LinkNavigationResult> {
    throwIfAborted(signal);
    const testPage = await context.newPage();
    try {
        const response = await testPage.goto(absoluteHref, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });
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
