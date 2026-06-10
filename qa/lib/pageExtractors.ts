import type { Page, Locator } from "playwright";

import { findBusinessAreaScope } from "./businessAreaScope";
import { normalizeForCompare, shouldIgnoreValue } from "./normalizeText";
import { getIgnoreValues, listTextFieldsForQa } from "./loadExcelByLocale";
import { readActualTextForCell, readActualTextForCellOnPage } from "./readActualCellText";
import type { TranslationCheckResult } from "./types";

/** Business Area scope locator — waitForBusinessAreaScope 결과 또는 즉시 탐색 */
export async function resolveBusinessAreaLocator(page: Page): Promise<Locator | null> {
    const found = await findBusinessAreaScope(page);
    return found?.locator ?? null;
}

/**
 * 로케일 페이지 DOM 에서 엑셀 셀 텍스트가 반영됐는지 검증한다.
 * - 대상: placeholder-map D~G열 텍스트 필드
 * - 빈 값·ignoreValues(N/A 등)는 skip
 */
export async function verifyTranslationsOnPage(
    page: Page,
    cellValueMap: Record<string, string>,
    scopeLocator?: Locator | null,
): Promise<TranslationCheckResult[]> {
    const ignoreValues = getIgnoreValues();
    const fields = listTextFieldsForQa();
    const scope = scopeLocator ?? (await resolveBusinessAreaLocator(page));

    if (!scope || (await scope.count()) === 0) {
        return Promise.all(
            fields.map(async (field) => {
                const expected = cellValueMap[field.cell] ?? "";
                if (shouldIgnoreValue(expected, ignoreValues)) {
                    return {
                        status: "skip" as const,
                        cell: field.cell,
                        label: field.label,
                        expected,
                        detail: "Business Area 영역을 찾을 수 없어 skip",
                    };
                }
                const actual = await readActualTextForCellOnPage(page, field.cell);
                return {
                    status: "fail" as const,
                    cell: field.cell,
                    label: field.label,
                    expected,
                    actual,
                    detail: "Business Area 영역을 찾을 수 없습니다.",
                };
            }),
        );
    }

    /** scope 내부 전체 텍스트(줄바꿈·br 포함)를 한 번만 읽어 셀별 포함 여부 검사 */
    const domText = await scope.evaluate((el) => {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
        return clone.innerText ?? clone.textContent ?? "";
    });
    const normalizedDom = normalizeForCompare(domText);

    const results: TranslationCheckResult[] = [];

    for (const field of fields) {
        const expected = cellValueMap[field.cell] ?? "";

        if (shouldIgnoreValue(expected, ignoreValues)) {
            results.push({
                status: "skip",
                cell: field.cell,
                label: field.label,
                expected,
            });
            continue;
        }

        const normalizedExpected = normalizeForCompare(expected);
        const found = normalizedDom.includes(normalizedExpected);

        if (found) {
            results.push({
                status: "pass",
                cell: field.cell,
                label: field.label,
                expected,
            });
            continue;
        }

        const actual = await readActualTextForCell(scope, field.cell);
        results.push({
            status: "fail",
            cell: field.cell,
            label: field.label,
            expected,
            actual,
            detail: "Business Area DOM 에 기대 텍스트가 없습니다.",
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
): Promise<ExtractedLink[]> {
    const scope = scopeLocator ?? (await resolveBusinessAreaLocator(page));
    if (!scope || (await scope.count()) === 0) {
        return [];
    }

    const anchors = scope.locator("a[href]");
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
export function isLgComHref(href: string): boolean {
    return /^(https?:)?\/\/(www\.)?lg\.com\//i.test(href) || href.startsWith("/");
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
