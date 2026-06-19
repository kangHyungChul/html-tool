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

        if (actual === "(해당 위치 요소 없음)") {
            results.push({
                status: "fail",
                cell: field.cell,
                label: field.label,
                expected,
                actual,
                detail: "검증 대상 `.business-area` 에 템플릿과 동일 구조 위치가 없습니다.",
            });
            continue;
        }

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
            detail: "템플릿 동일 구조 위치에 locale 엑셀 번역이 반영되지 않았습니다.",
        });
    }

    return results;
}

/** 페이지에서 테스트 대상 `<a>` 목록 추출 (javascript:, #, 빈 href 제외) */
export interface ExtractedLink {
    /** scope 내 `a[href]` 추출 순번 (0-based) */
    anchorIndex: number;
    href: string;
    linkText: string;
    targetBlank: boolean;
    locator: Locator;
}

/**
 * QA 결과 CTA 컬럼용 링크 표시 텍스트.
 * 1) 보이는 innerText 2) aria-label 3) 이미지 전용 링크면 "image" 4) 식별용 href
 */
async function resolveLinkDisplayText(locator: Locator, href: string): Promise<string> {
    const innerText = (await locator.innerText()).trim();
    if (innerText) {
        return innerText;
    }

    const ariaLabel = (await locator.getAttribute("aria-label"))?.trim() ?? "";
    if (ariaLabel) {
        return ariaLabel;
    }

    /** c-media-contents 등 — 텍스트 없이 img만 감싼 `<a>` (alt는 innerText에 포함되지 않음) */
    const hasImg = (await locator.locator("img").count()) > 0;
    if (hasImg) {
        return "image";
    }

    return href;
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
        const linkText = await resolveLinkDisplayText(locator, href);

        links.push({ anchorIndex: links.length, href, linkText, targetBlank, locator });
    }

    return links;
}

/** href 를 페이지 기준 절대 URL 로 변환한 뒤 pathname 추출 (테스트 도메인·상대 경로 공통) */
export function getHrefPathname(href: string, pageUrl: string): string {
    try {
        return new URL(href, pageUrl).pathname;
    } catch {
        return href;
    }
}

/** http(s) 링크 — mailto·tel 등 비탐색 프로토콜 제외 */
export function isNavigableAbsoluteHref(absoluteHref: string): boolean {
    try {
        const protocol = new URL(absoluteHref).protocol;
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}

/** lg.com URL 인지 여부 */
export function isLgComHref(href: string, config?: QaConfig): boolean {
    return isLgComHrefByConfig(href, config ?? getQaConfig());
}

/** href 경로에 `/global/` locale 세그먼트가 있는지 (호스트 무관 — stg·www 등) */
export function hrefUsesGlobalSegment(href: string, pageUrl: string): boolean {
    const pathname = getHrefPathname(href, pageUrl);
    return /^\/global(?:\/|$)/i.test(pathname);
}

/** href 경로에 `/uk/` 등 locale 세그먼트가 있는지 (호스트 무관) */
export function hrefUsesLocaleSegment(href: string, localeKey: string, pageUrl: string): boolean {
    const seg = localeKey.trim().toLowerCase();
    const escaped = seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pathname = getHrefPathname(href, pageUrl);
    return new RegExp(`^/${escaped}(?:/|$)`, "i").test(pathname);
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
