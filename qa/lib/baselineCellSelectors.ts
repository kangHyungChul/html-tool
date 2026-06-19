import type { Locator } from "playwright";

import type { CellTextReadFrom } from "./cellTextRead";
import { getCellTemplateDomMapping } from "./cellDomSelectors";
import { getIgnoreValues, listTextFieldsForQa } from "./loadExcelByLocale";
import { normalizeForCompare, shouldIgnoreValue } from "./normalizeText";
import { readTextAtRelativeSelector } from "./readActualCellText";
import { throwIfAborted } from "./businessAreaScope";

/** 셀 한 개의 DOM 위치 매핑 결과 */
export interface CellDomMapping {
    /** `.business-area` 루트 기준 상대 CSS 셀렉터 (템플릿 구조) */
    relativeSelector: string;
    /** 템플릿 placeholder 위치 + as-is 페이지에서 global 텍스트로 확정 */
    source: "template-structure";
    /** locale 검증 시 읽을 속성 */
    readFrom: CellTextReadFrom;
}

export interface ResolveCellSelectorsResult {
    mappings: Map<string, CellDomMapping>;
    /** 비교군 페이지에서 구조·global 텍스트로 위치를 확정하지 못한 셀 */
    unresolved: { cell: string; label: string; baselineText: string; reason: string }[];
}

/**
 * 템플릿 `{D6}` 구조(클래스·DOM 경로)로 셀 위치를 고정하고,
 * as-is 페이지에서 해당 위치의 global 엑셀 텍스트와 일치하는지만 확인한다.
 *
 * 검증 대상 페이지는 **동일 relativeSelector** 에 locale 엑셀 값만 비교한다.
 * (DOM 전체 텍스트 검색으로 위치를 찾지 않음 → 오탐 감소)
 */
export async function resolveCellSelectorsFromBaseline(
    scope: Locator,
    baselineCellMap: Record<string, string>,
    options?: {
        signal?: AbortSignal;
        onProgress?: (current: number, total: number) => void;
    },
): Promise<ResolveCellSelectorsResult> {
    const ignoreValues = getIgnoreValues();
    const fields = listTextFieldsForQa();
    const mappings = new Map<string, CellDomMapping>();
    const unresolved: ResolveCellSelectorsResult["unresolved"] = [];

    let processed = 0;
    const total = fields.length;

    for (const field of fields) {
        throwIfAborted(options?.signal);
        processed += 1;
        options?.onProgress?.(processed, total);

        const baselineText = baselineCellMap[field.cell] ?? "";
        if (shouldIgnoreValue(baselineText, ignoreValues)) {
            continue;
        }

        const templateMapping = getCellTemplateDomMapping(field.cell);
        if (!templateMapping) {
            unresolved.push({
                cell: field.cell,
                label: field.label,
                baselineText,
                reason: "템플릿에 해당 셀 placeholder 구조가 정의되어 있지 않습니다.",
            });
            continue;
        }

        const locator = scope.locator(templateMapping.relativeSelector);
        const count = await locator.count();

        if (count === 0) {
            unresolved.push({
                cell: field.cell,
                label: field.label,
                baselineText,
                reason:
                    "as-is `.business-area` 에 템플릿과 동일 구조 위치가 없습니다. (relativeSelector 미매칭)",
            });
            continue;
        }

        if (count > 1) {
            unresolved.push({
                cell: field.cell,
                label: field.label,
                baselineText,
                reason: `템플릿 구조 셀렉터가 as-is 페이지에서 ${count}개 요소와 매칭됩니다. (유일하지 않음)`,
            });
            continue;
        }

        const actualAtBaseline = await readTextAtRelativeSelector(
            scope,
            templateMapping.relativeSelector,
            templateMapping.readFrom,
        );

        const normalizedBaseline = normalizeForCompare(baselineText);
        const normalizedActual = normalizeForCompare(actualAtBaseline);

        if (normalizedActual !== normalizedBaseline) {
            unresolved.push({
                cell: field.cell,
                label: field.label,
                baselineText,
                reason: `템플릿 구조 위치의 as-is DOM 값이 global 엑셀과 불일치합니다. (actual: ${actualAtBaseline})`,
            });
            continue;
        }

        mappings.set(field.cell.toUpperCase(), {
            relativeSelector: templateMapping.relativeSelector,
            source: "template-structure",
            readFrom: templateMapping.readFrom,
        });
    }

    return { mappings, unresolved };
}
