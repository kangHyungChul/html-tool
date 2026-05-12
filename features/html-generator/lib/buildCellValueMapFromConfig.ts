import type { BusinessAreaCellMapConfig, CellValueMap } from "../types/cellMapConfig.types";

/**
 * JSON `sections[].fields[]`의 `initialValue`만 모아 CellValueMap을 만든다.
 * - 엑셀을 아직 올리지 않았을 때 우측 패널·placeholder 치환의 기본값으로 쓴다.
 * - `initialValue`가 없으면 해당 셀은 빈 문자열로 둔다.
 * - 동일 `cell`이 여러 필드에 중복되면 JSON 순서상 **마지막** 필드의 값이 남는다.
 */
export function buildCellValueMapFromInitialValues(cfg: BusinessAreaCellMapConfig): CellValueMap {
    const map: CellValueMap = {};

    for (const section of cfg.sections) {
        for (const field of section.fields) {
            map[field.cell] = field.initialValue ?? "";
        }
    }

    return map;
}

/**
 * 엑셀에서 추출한 값과 JSON 기본값을 합친다.
 * - 추출 값이 빈 문자열이면(빈 셀, N/A 정규화 후 등) 해당 셀은 `initialValue`로 되돌린다.
 * - 추출 값이 비어 있지 않으면 엑셀 값을 그대로 쓴다.
 */
export function mergeExtractedWithInitialFallback(
    extracted: CellValueMap,
    cfg: BusinessAreaCellMapConfig,
): CellValueMap {
    const defaults = buildCellValueMapFromInitialValues(cfg);
    const result: CellValueMap = { ...defaults };

    for (const cell of Object.keys(extracted)) {
        const value = extracted[cell];
        result[cell] = value === "" ? (defaults[cell] ?? "") : value;
    }

    return result;
}
