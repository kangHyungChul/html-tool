import type { CellDomMapping, ResolveCellSelectorsResult } from "./baselineCellSelectors";
import { getIgnoreValues, listTextFieldsForQa } from "./loadExcelByLocale";
import { shouldIgnoreValue } from "./normalizeText";
import type { BaselineMappingPhaseResult } from "./types";

/** baseline-locate 완료 후 UI·스트림용 매핑 결과表 생성 */
export function buildBaselineMappingPhaseResult(
    baselineCellMap: Record<string, string>,
    mappings: Map<string, CellDomMapping>,
    unresolved: ResolveCellSelectorsResult["unresolved"],
): BaselineMappingPhaseResult {
    const ignoreValues = getIgnoreValues();
    const unresolvedByCell = new Map(unresolved.map((u) => [u.cell.toUpperCase(), u]));

    const rows = listTextFieldsForQa().map((field) => {
        const baselineText = baselineCellMap[field.cell] ?? "";

        if (shouldIgnoreValue(baselineText, ignoreValues)) {
            return {
                cell: field.cell,
                label: field.label,
                baselineText,
                status: "skipped" as const,
            };
        }

        const failed = unresolvedByCell.get(field.cell.toUpperCase());
        if (failed) {
            return {
                cell: field.cell,
                label: field.label,
                baselineText,
                status: "unresolved" as const,
                reason: failed.reason,
            };
        }

        const mapping = mappings.get(field.cell.toUpperCase());
        if (mapping) {
            return {
                cell: field.cell,
                label: field.label,
                baselineText,
                status: "mapped" as const,
                source: mapping.source,
                readFrom: mapping.readFrom,
                relativeSelector: mapping.relativeSelector,
            };
        }

        return {
            cell: field.cell,
            label: field.label,
            baselineText,
            status: "unresolved" as const,
            reason: "템플릿 구조 위치를 확정하지 못했습니다.",
        };
    });

    return {
        phase: "baseline-locate",
        rows,
        summary: {
            mapped: rows.filter((r) => r.status === "mapped").length,
            unresolved: rows.filter((r) => r.status === "unresolved").length,
            skipped: rows.filter((r) => r.status === "skipped").length,
        },
    };
}
