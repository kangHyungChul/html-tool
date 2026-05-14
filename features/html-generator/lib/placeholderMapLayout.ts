import type { PlaceholderMapConfig, PlaceholderMapField, PlaceholderMapExcelLayout } from "../types/cellMapConfig.types";

/**
 * JSON에 `excelLayout` 이 없을 때 쓰는 기본값.
 * 현재 `business_area_template.xlsx` / placeholder-map 샘플 기준: 2~3행이 상단 타이틀·탭 헤더, 4행부터 본문.
 */
const DEFAULT_SHEET_TITLE_ROW_RANGE: PlaceholderMapExcelLayout["sheetTitleRowRange"] = {
    startRow: 2,
    endRow: 3,
};

/**
 * 셀 주소에서 행 번호만 뽑는다 (1-based). 잘못된 주소면 null.
 *
 * @example parseCellRowFromAddress("D4") === 4
 */
export function parseCellRowFromAddress(cell: string): number | null {
    const normalized = cell.replace(/\$/g, "").toUpperCase();
    const m = normalized.match(/^[A-Z]+(\d+)$/);
    if (!m) {
        return null;
    }
    const row = Number.parseInt(m[1], 10);
    return Number.isFinite(row) && row > 0 ? row : null;
}

/**
 * JSON 또는 기본값에서 «시트 타이틀» 행 범위를 가져온다.
 */
export function getSheetTitleRowRange(cfg: PlaceholderMapConfig): PlaceholderMapExcelLayout["sheetTitleRowRange"] {
    return cfg.excelLayout?.sheetTitleRowRange ?? DEFAULT_SHEET_TITLE_ROW_RANGE;
}

/**
 * 해당 필드가 엑셀 시트 상단 타이틀/메타 구역에 해당하는지.
 * - `excelLayout.sheetTitleRowRange` 안의 행이면 true
 * - JSON에 `excelLayout` 이 없으면 기본 2~3행
 */
export function isSheetTitleAreaField(field: PlaceholderMapField, cfg: PlaceholderMapConfig): boolean {
    const row = parseCellRowFromAddress(field.cell);
    if (row === null) {
        return false;
    }
    const { startRow, endRow } = getSheetTitleRowRange(cfg);
    return row >= startRow && row <= endRow;
}

/**
 * `fields` 배열에서 시트 타이틀 구역만 골라낸다.
 */
export function filterSheetTitleAreaFields(cfg: PlaceholderMapConfig): PlaceholderMapField[] {
    const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
    return fields.filter((f) => isSheetTitleAreaField(f, cfg));
}

/**
 * 시트 타이틀 구역이 **아닌** 필드만 (본문·아코디언 등).
 */
export function filterNonSheetTitleAreaFields(cfg: PlaceholderMapConfig): PlaceholderMapField[] {
    const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
    return fields.filter((f) => !isSheetTitleAreaField(f, cfg));
}
