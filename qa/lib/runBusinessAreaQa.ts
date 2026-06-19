import type { Browser } from "playwright";

import { buildBaselineMappingPhaseResult } from "./qaPhaseResults";
import { resolveCellSelectorsFromBaseline } from "./baselineCellSelectors";
import { gotoQaTargetPage, throwIfAborted, waitForBusinessAreaRoot } from "./businessAreaScope";
import { prepareScopeForQa } from "./prepareScopeForQa";
import { extractCellMapForLocaleKey } from "./loadExcelByLocale";
import { extractLinksInBusinessArea, isLgComHref, resolveAbsoluteHref, verifyTranslationsOnPage } from "./pageExtractors";
import { launchQaBrowser } from "./playwrightBrowser";
import { resolveQaConfig } from "./qaConfig";
import { verifyLinkLocaleRules, verifyLinkNavigation } from "./verifyLinks";
import type {
    BusinessAreaQaInput,
    BusinessAreaQaReport,
    BusinessAreaQaRunOptions,
    LinkLocaleRuleResult,
    LinkNavigationResult,
    QaPhaseResult,
    QaProgressEvent,
    TranslationCheckResult,
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

function emitPhaseResult(
    options: BusinessAreaQaRunOptions | undefined,
    result: QaPhaseResult,
): void {
    throwIfAborted(options?.signal);
    options?.onPhaseResult?.(result);
}

/**
 * Business Area QA 전체 실행.
 * 설정: `qa/qa.config.ts` (options.config 로 런타임 덮어쓰기 가능)
 */
export async function runBusinessAreaQa(
    input: BusinessAreaQaInput,
    options?: BusinessAreaQaRunOptions,
): Promise<BusinessAreaQaReport> {
    const config = resolveQaConfig({ config: options?.config });
    const localeKey = input.localeKey.trim().toLowerCase();
    const signal = options?.signal;
    const { phases, links, excel } = config;

    const runTranslation = phases.translation;
    const runLinkLocale =
        phases.linkLocaleRules && links.enabled.localePathRules;
    const runLinkNavigation =
        phases.linkNavigation && links.enabled.navigationCheck;
    const runAnyLinks = runLinkLocale || runLinkNavigation;

    emitProgress(options, {
        phase: "excel",
        message: "엑셀 파일 파싱 중…",
        percent: 5,
    });
    throwIfAborted(signal);

    const baselineExcel = runTranslation
        ? extractCellMapForLocaleKey(input.baselineXlsxBuffer, excel.baselineSheetKey)
        : null;
    const targetExcel = runTranslation
        ? extractCellMapForLocaleKey(input.targetXlsxBuffer, localeKey)
        : null;

    let browser: Browser | null = null;
    let translations: TranslationCheckResult[] = [];
    let linkLocaleRules: LinkLocaleRuleResult[] = [];
    let linkNavigation: LinkNavigationResult[] = [];
    let cellMappings = new Map<
        string,
        import("./baselineCellSelectors").CellDomMapping
    >();
    let unresolvedBaseline: import("./baselineCellSelectors").ResolveCellSelectorsResult["unresolved"] =
        [];

    try {
        emitProgress(options, {
            phase: "browser",
            message: "Playwright 브라우저 시작 중…",
            percent: 8,
        });
        throwIfAborted(signal);

        const { browser: qaBrowser, context } = await launchQaBrowser(config);
        browser = qaBrowser;
        const page = await context.newPage();

        if (runTranslation && baselineExcel && targetExcel) {
            emitProgress(options, {
                phase: "baseline-load",
                message: `비교군 페이지 로드: ${input.baselineUrl}`,
                percent: 12,
            });
            throwIfAborted(signal);

            await gotoQaTargetPage(page, input.baselineUrl, signal, config);

            emitProgress(options, {
                phase: "baseline-locate",
                message: "as-is 페이지에서 템플릿 구조·global 엑셀 위치 확인 중…",
                percent: 18,
            });
            throwIfAborted(signal);

            const baselineBusinessArea = await waitForBusinessAreaRoot(page, {
                timeoutMs: config.timeouts.businessAreaRootMs,
                signal,
                config,
                onProgress: (partial) => {
                    emitProgress(options, {
                        phase: "baseline-locate",
                        message: partial.message,
                        percent: 20,
                    });
                },
            });

            await prepareScopeForQa(page, baselineBusinessArea, config, {
                onProgress: (message) => {
                    emitProgress(options, {
                        phase: "baseline-locate",
                        message,
                        percent: 21,
                    });
                },
            });

            const resolved = await resolveCellSelectorsFromBaseline(
                baselineBusinessArea,
                baselineExcel.cellMap,
                {
                    signal,
                    config,
                    onProgress: (current, total) => {
                        emitProgress(options, {
                            phase: "baseline-locate",
                            message: `as-is 위치 매핑 (${current}/${total})…`,
                            percent: Math.round(22 + (current / total) * 18),
                            current,
                            total,
                        });
                    },
                },
            );
            cellMappings = resolved.mappings;
            unresolvedBaseline = resolved.unresolved;

            emitPhaseResult(
                options,
                buildBaselineMappingPhaseResult(
                    baselineExcel.cellMap,
                    cellMappings,
                    unresolvedBaseline,
                ),
            );
        }

        emitProgress(options, {
            phase: "page-load",
            message: `검증 대상 페이지 로드: ${input.targetUrl}`,
            percent: 42,
        });
        throwIfAborted(signal);

        await gotoQaTargetPage(page, input.targetUrl, signal, config);

        emitProgress(options, {
            phase: "business-area",
            message: "검증 대상 Business Area 탐색 중…",
            percent: 48,
        });
        throwIfAborted(signal);

        const targetBusinessArea = await waitForBusinessAreaRoot(page, {
            timeoutMs: config.timeouts.businessAreaRootMs,
            signal,
            config,
            onProgress: (partial) => {
                emitProgress(options, {
                    phase: "business-area",
                    message: partial.message,
                    percent: 50,
                });
            },
        });

        await prepareScopeForQa(page, targetBusinessArea, config, {
            onProgress: (message) => {
                emitProgress(options, {
                    phase: "business-area",
                    message,
                    percent: 52,
                });
            },
        });

        if (runTranslation && baselineExcel && targetExcel) {
            emitProgress(options, {
                phase: "translation",
                message: "locale 엑셀 ↔ 동일 DOM 위치 번역 검증 중…",
                percent: 55,
            });
            throwIfAborted(signal);

            translations = await verifyTranslationsOnPage(
                page,
                targetExcel.cellMap,
                baselineExcel.cellMap,
                cellMappings,
                unresolvedBaseline,
                targetBusinessArea,
            );

            emitPhaseResult(options, {
                phase: "translation",
                results: translations,
                summary: countByStatus(translations),
            });
        }

        if (runAnyLinks) {
            emitProgress(options, {
                phase: "link-extract",
                message: "Business Area 내 링크 추출 중…",
                percent: 62,
            });
            throwIfAborted(signal);

            const rawLinks = await extractLinksInBusinessArea(page, targetBusinessArea, config);
            const pageUrl = page.url();

            const lgComLinkCount = rawLinks.filter((l) =>
                isLgComHref(resolveAbsoluteHref(l.href, pageUrl), config),
            ).length;

            emitPhaseResult(options, {
                phase: "link-extract",
                extracted: rawLinks.length,
                lgCom: lgComLinkCount,
                targetBlank: rawLinks.filter((l) => l.targetBlank).length,
            });

            if (runLinkLocale) {
                emitProgress(options, {
                    phase: "link-locale",
                    message: `링크 경로(global/locale) 검증 중… (${rawLinks.length}개)`,
                    percent: 68,
                });
                throwIfAborted(signal);

                linkLocaleRules = verifyLinkLocaleRules(rawLinks, pageUrl, localeKey, config);

                emitPhaseResult(options, {
                    phase: "link-locale",
                    results: linkLocaleRules,
                    summary: countByStatus(linkLocaleRules),
                });
            }

            if (runLinkNavigation) {
                const navigableCount = lgComLinkCount;

                emitProgress(options, {
                    phase: "link-navigation",
                    message: `링크 클릭·404 검증 중… (0/${navigableCount})`,
                    percent: 72,
                    current: 0,
                    total: navigableCount,
                });
                throwIfAborted(signal);

                linkNavigation = await verifyLinkNavigation(browser, page, rawLinks, pageUrl, {
                    signal,
                    config,
                    onLinkProgress: (current, total) => {
                        const ratio = total > 0 ? current / total : 1;
                        emitProgress(options, {
                            phase: "link-navigation",
                            message: `링크 클릭·404 검증 중… (${current}/${total})`,
                            percent: Math.round(72 + ratio * 26),
                            current,
                            total,
                        });
                    },
                });

                emitPhaseResult(options, {
                    phase: "link-navigation",
                    results: linkNavigation,
                    summary: countByStatus(linkNavigation),
                });
            }
        }

        await context.close();

        const translationSummary = countByStatus(translations);
        const linkLocaleSummary = countByStatus(linkLocaleRules);
        const linkNavSummary = countByStatus(linkNavigation);

        const overallPass =
            (!runTranslation || translationSummary.fail === 0) &&
            (!runLinkLocale || linkLocaleSummary.fail === 0) &&
            (!runLinkNavigation || linkNavSummary.fail === 0);

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
                baselineSheetName: baselineExcel?.sheetName ?? excel.baselineSheetKey,
                targetSheetName: targetExcel?.sheetName ?? localeKey,
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
