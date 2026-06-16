import type { Page, Locator } from "playwright";

import type { CellDomMapping } from "./baselineCellSelectors";
import { getBusinessAreaRootLocator } from "./businessAreaScope";
import { getQaConfig, isLgComHrefByConfig, type QaConfig } from "./qaConfig";
import { normalizeForCompare, shouldIgnoreValue } from "./normalizeText";
import { getIgnoreValues, listTextFieldsForQa } from "./loadExcelByLocale";
import { readTextAtRelativeSelector } from "./readActualCellText";
import type { TranslationCheckResult } from "./types";

/** Business Area scope — config.page.businessAreaRootSelector */
export async function resolveBusinessAreaLocator(page: Page, config?: QaConfig): Promise<Locator | null> {
    return getBusinessAreaRootLocator(page, config);
}

/**
 * 검증 대상(locale) 페이지에서 비교군(global)이 잡아 둔 DOM 위치별로
 * locale 엑셀 기대 번역이 들어갔는지 검증한다.
 */
export async function verifyTranslationsOnPage(
    page: Page,
    targetCellMap: Record<string, string>,
    baselineCellMap: Record<string, string>,
    cellMappings: Map<string, CellDomMapping>,
    unresolvedBaseline: { cell: string; label: string; baselineText: string; reason: string }[],
    scopeLocator?: Locator | null,
): Promise<TranslationCheckResult[]> {
    const ignoreValues = getIgnoreValues();
    const fields = listTextFieldsForQa();
    const scope = scopeLocator ?? (await resolveBusinessAreaLocator(page));

    const unresolvedByCell = new Map(
        unresolvedBaseline.map((u) => [u.cell.toUpperCase(), u]),
    );

    if (!scope || (await scope.count()) === 0) {
        return fields.map((field) => {
            const expected = targetCellMap[field.cell] ?? "";
            if (shouldIgnoreValue(expected, ignoreValues)) {
                return {
                    status: "skip" as const,
                    cell: field.cell,
                    label: field.label,
                    expected,
                    detail: "Business Area 영역을 찾을 수 없어 skip",
                };
            }
            return {
                status: "fail" as const,
                cell: field.cell,
                label: field.label,
                expected,
                actual: "(Business Area 없음)",
                detail: "Business Area 영역을 찾을 수 없습니다.",
            };
        });
    }

    const results: TranslationCheckResult[] = [];

    for (const field of fields) {
        const expected = targetCellMap[field.cell] ?? "";
        const baselineText = baselineCellMap[field.cell] ?? "";

        if (shouldIgnoreValue(baselineText, ignoreValues) || shouldIgnoreValue(expected, ignoreValues)) {
            results.push({
                status: "skip",
                cell: field.cell,
                label: field.label,
                expected,
            });
            continue;
        }

        const unresolved = unresolvedByCell.get(field.cell.toUpperCase());
        if (unresolved) {
            results.push({
                status: "fail",
                cell: field.cell,
                label: field.label,
                expected,
                detail: unresolved.reason,
            });
            continue;
        }

        const mapping = cellMappings.get(field.cell.toUpperCase());
        if (!mapping) {
            results.push({
                status: "fail",
                cell: field.cell,
                label: field.label,
                expected,
                detail: "비교군 페이지에서 DOM 위치를 확정하지 못했습니다.",
            });
            continue;
        }

        const actual = await readTextAtRelativeSelector(scope, mapping.relativeSelector, mapping.readFrom);
        const normalizedExpected = normalizeForCompare(expected);
        const normalizedActual = normalizeForCompare(actual);

        if (normalizedActual === normalizedExpected) {
            results.push({
                status: "pass",
                cell: field.cell,
                label: field.label,
                expected,
            });
            continue;
        }

        results.push({
            status: "fail",
            cell: field.cell,
            label: field.label,
            expected,
            actual,
            detail: "비교군과 동일 DOM 위치에 locale 엑셀 번역이 반영되지 않았습니다.",
        });
    }

    return results;
}

/** 페이지에서 테스트 대상 `<a>` 목록 추출 (javascript:, #, 빈 href 제외) */
export interface ExtractedLink {
    href: string;
    linkText: string;
    targetBlank: boolean;
    locator: Locator;
}

export async function extractLinksInBusinessArea(
    page: Page,
    scopeLocator?: Locator | null,
    config?: QaConfig,
): Promise<ExtractedLink[]> {
    const c = config ?? getQaConfig();
    const scope = scopeLocator ?? (await resolveBusinessAreaLocator(page, c));
    if (!scope || (await scope.count()) === 0) {
        return [];
    }

    const anchors = scope.locator(c.page.linkExtractSelector);
    const count = await anchors.count();
    const links: ExtractedLink[] = [];

    for (let i = 0; i < count; i += 1) {
        const locator = anchors.nth(i);
        const href = (await locator.getAttribute("href"))?.trim() ?? "";
        if (!href || href.startsWith("#") || /^javascript:/i.test(href)) {
            continue;
        }

        const target = (await locator.getAttribute("target"))?.trim().toLowerCase() ?? "";
        const targetBlank = target === "_blank";
        const linkText = normalizeForCompare(await locator.innerText()) || href;

        links.push({ href, linkText, targetBlank, locator });
    }

    return links;
}

/** lg.com URL 인지 여부 */
export function isLgComHref(href: string, config?: QaConfig): boolean {
    return isLgComHrefByConfig(href, config ?? getQaConfig());
}

/** href 가 global 경로인지 */
export function hrefUsesGlobalSegment(href: string): boolean {
    return /\/\/(www\.)?lg\.com\/global\//i.test(href) || /^\/global\//i.test(href);
}

/** href 가 특정 locale 세그먼트를 쓰는지 */
export function hrefUsesLocaleSegment(href: string, localeKey: string): boolean {
    const seg = localeKey.trim().toLowerCase();
    const re = new RegExp(`//(www\\.)?lg\\.com/${seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "i");
    const relRe = new RegExp(`^/${seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "i");
    return re.test(href) || relRe.test(href);
}

/** 상대 URL을 절대 URL로 (페이지 origin 기준) */
export function resolveAbsoluteHref(href: string, pageUrl: string): string {
    try {
        return new URL(href, pageUrl).href;
    } catch {
        return href;
    }
}

/** LG 404 페이지 휴리스틱 — HTTP 상태 + 본문 키워드 */
export async function pageLooksLike404(page: Page, httpStatus?: number): Promise<boolean> {
    if (httpStatus !== undefined && httpStatus >= 400) {
        return true;
    }

    const title = (await page.title()).toLowerCase();
    if (title.includes("404") || title.includes("not found") || title.includes("page not found")) {
        return true;
    }

    const bodySnippet = normalizeForCompare(await page.locator("body").innerText().catch(() => ""));
    const markers = ["404", "page not found", "not found", "cannot be found", "페이지를 찾을 수 없"];
    return markers.some((m) => bodySnippet.includes(normalizeForCompare(m)));
}
