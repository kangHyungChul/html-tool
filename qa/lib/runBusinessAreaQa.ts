import type { Browser, Page } from "playwright";

import { gotoQaTargetPage, throwIfAborted, waitForBusinessAreaScope } from "./businessAreaScope";
import { extractCellMapForLocaleKey } from "./loadExcelByLocale";
import { extractLinksInBusinessArea, verifyTranslationsOnPage } from "./pageExtractors";
import { launchQaBrowser } from "./playwrightBrowser";
import { verifyLinkLocaleRules, verifyLinkNavigation } from "./verifyLinks";
import type {
    BusinessAreaQaInput,
    BusinessAreaQaReport,
    BusinessAreaQaRunOptions,
    QaProgressEvent,
} from "./types";

function countByStatus<T extends { status: string }>(items: T[]): { pass: number; fail: number; skip: number } {
    let pass = 0;
    let fail = 0;
    let skip = 0;
    for (const item of items) {
        if (item.status === "pass") {
            pass += 1;
        } else if (item.status === "fail") {
            fail += 1;
        } else {
            skip += 1;
        }
    }
    return { pass, fail, skip };
}

function emitProgress(
    options: BusinessAreaQaRunOptions | undefined,
    event: QaProgressEvent,
): void {
    throwIfAborted(options?.signal);
    options?.onProgress?.(event);
}

/**
 * Business Area QA 전체 실행.
 * - Playwright headless Chromium
 * - baseline 엑셀은 시트 존재·양식 검증용, 텍스트 검증은 target 엑셀 ↔ target URL
 */
export async function runBusinessAreaQa(
    input: BusinessAreaQaInput,
    options?: BusinessAreaQaRunOptions,
): Promise<BusinessAreaQaReport> {
    const localeKey = input.localeKey.trim().toLowerCase();
    const signal = options?.signal;

    emitProgress(options, {
        phase: "excel",
        message: "엑셀 파일 파싱 중…",
        percent: 5,
    });
    throwIfAborted(signal);

    const baselineExcel = extractCellMapForLocaleKey(input.baselineXlsxBuffer, "global");
    const targetExcel = extractCellMapForLocaleKey(input.targetXlsxBuffer, localeKey);

    void baselineExcel;

    let browser: Browser | null = null;

    try {
        emitProgress(options, {
            phase: "browser",
            message: "Playwright 브라우저 시작 중…",
            percent: 10,
        });
        throwIfAborted(signal);

        const { browser: qaBrowser, context } = await launchQaBrowser();
        browser = qaBrowser;
        const page = await context.newPage();

        emitProgress(options, {
            phase: "page-load",
            message: `페이지 로드 중: ${input.targetUrl}`,
            percent: 18,
        });
        throwIfAborted(signal);

        await gotoQaTargetPage(page, input.targetUrl, signal);

        emitProgress(options, {
            phase: "business-area",
            message: "Business Area 컴포넌트 탐색 중…",
            percent: 28,
        });
        throwIfAborted(signal);

        const businessArea = await waitForBusinessAreaScope(page, {
            timeoutMs: 45_000,
            signal,
            onProgress: (partial) => {
                emitProgress(options, {
                    phase: "business-area",
                    message: partial.message,
                    percent: 32,
                });
            },
        });

        emitProgress(options, {
            phase: "translation",
            message: "번역(엑셀→DOM) 검증 중…",
            percent: 45,
        });
        throwIfAborted(signal);

        const translations = await verifyTranslationsOnPage(
            page,
            targetExcel.cellMap,
            businessArea.locator,
        );

        emitProgress(options, {
            phase: "link-extract",
            message: "Business Area 내 링크 추출 중…",
            percent: 52,
        });
        throwIfAborted(signal);

        const rawLinks = await extractLinksInBusinessArea(page, businessArea.locator);
        const pageUrl = page.url();

        emitProgress(options, {
            phase: "link-locale",
            message: `링크 경로(global/locale) 검증 중… (${rawLinks.length}개)`,
            percent: 58,
        });
        throwIfAborted(signal);

        const linkLocaleRules = verifyLinkLocaleRules(rawLinks, pageUrl, localeKey);

        const navigableCount = rawLinks.filter((l) => {
            const href = l.href;
            return /^(https?:)?\/\/(www\.)?lg\.com\//i.test(href) || href.startsWith("/");
        }).length;

        emitProgress(options, {
            phase: "link-navigation",
            message: `링크 클릭·404 검증 중… (0/${navigableCount})`,
            percent: 62,
            current: 0,
            total: navigableCount,
        });
        throwIfAborted(signal);

        const linkNavigation = await verifyLinkNavigation(browser, page, rawLinks, pageUrl, {
            signal,
            onLinkProgress: (current, total) => {
                const ratio = total > 0 ? current / total : 1;
                emitProgress(options, {
                    phase: "link-navigation",
                    message: `링크 클릭·404 검증 중… (${current}/${total})`,
                    percent: Math.round(62 + ratio * 33),
                    current,
                    total,
                });
            },
        });

        await context.close();

        const translationSummary = countByStatus(translations);
        const linkLocaleSummary = countByStatus(linkLocaleRules);
        const linkNavSummary = countByStatus(linkNavigation);

        const overallPass =
            translationSummary.fail === 0 &&
            linkLocaleSummary.fail === 0 &&
            linkNavSummary.fail === 0;

        emitProgress(options, {
            phase: "done",
            message: overallPass ? "QA 완료 — PASS" : "QA 완료 — FAIL",
            percent: 100,
        });

        return {
            generatedAt: new Date().toISOString(),
            input: {
                baselineUrl: input.baselineUrl,
                targetUrl: input.targetUrl,
                localeKey,
                baselineSheetName: baselineExcel.sheetName,
                targetSheetName: targetExcel.sheetName,
            },
            summary: {
                translation: translationSummary,
                linkLocaleRule: linkLocaleSummary,
                linkNavigation: linkNavSummary,
                overallPass,
            },
            translations,
            linkLocaleRules,
            linkNavigation,
        };
    } finally {
        if (browser) {
            await browser.close().catch(() => undefined);
        }
    }
}
