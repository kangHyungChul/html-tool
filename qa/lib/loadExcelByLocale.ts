import { read, type WorkBook, type WorkSheet } from "xlsx";

import { loadPlaceholderMapJson } from "./assets";
import {
    extractCellDataFromSheet,
    isBusinessAreaSheet,
} from "./shared/extractBusinessAreaCellData";
import { adaptPlaceholderMapToCellMap } from "./shared/placeholderMapToBusinessAreaCellMap";
import type { CellValueMap, PlaceholderMapConfig } from "./shared/cellMapConfig.types";

const placeholderMapJson = loadPlaceholderMapJson();

const { cellMap: CONFIG } = adaptPlaceholderMapToCellMap(placeholderMapJson as PlaceholderMapConfig);

/** 버퍼에서 SheetJS Workbook 로드 */
export function loadWorkbookFromBuffer(buffer: Buffer): WorkBook {
    return read(buffer, { type: "buffer", cellDates: true });
}

/**
 * locale-map 키와 1:1 매칭되는 시트를 찾는다.
 * - 정확히 일치(대소문자 무시)
 * - 없으면 `ca_en` → `ca` 처럼 첫 `_` 앞 접두어로 한 번 더 시도
 */
export function resolveSheetNameForLocaleKey(workbook: WorkBook, localeKey: string): string | null {
    const names = workbook.SheetNames ?? [];
    if (names.length === 0) {
        return null;
    }

    const normalizedKey = localeKey.trim().toLowerCase();

    const exact = names.find((name) => name.trim().toLowerCase() === normalizedKey);
    if (exact) {
        return exact;
    }

    const underscore = normalizedKey.indexOf("_");
    if (underscore > 0) {
        const prefix = normalizedKey.slice(0, underscore);
        const byPrefix = names.find((name) => name.trim().toLowerCase() === prefix);
        if (byPrefix) {
            return byPrefix;
        }
    }

    return null;
}

/** locale 키에 해당하는 시트에서 CellValueMap 추출. 양식 불일치 시 throw */
export function extractCellMapForLocaleKey(buffer: Buffer, localeKey: string): {
    sheetName: string;
    cellMap: CellValueMap;
} {
    const workbook = loadWorkbookFromBuffer(buffer);
    const sheetName = resolveSheetNameForLocaleKey(workbook, localeKey);
    if (!sheetName) {
        throw new Error(
            `엑셀에서 locale 키「${localeKey}」와 일치하는 시트를 찾을 수 없습니다. 시트명을 locale 키와 동일하게 맞춰 주세요.`,
        );
    }

    const sheet: WorkSheet | undefined = workbook.Sheets[sheetName];
    if (!sheet) {
        throw new Error(`시트「${sheetName}」를 읽을 수 없습니다.`);
    }

    if (!isBusinessAreaSheet(sheet, CONFIG)) {
        throw new Error(`시트「${sheetName}」가 Business Area 카피덱 양식과 맞지 않습니다.`);
    }

    return {
        sheetName,
        cellMap: extractCellDataFromSheet(sheet, CONFIG),
    };
}

/** placeholder-map 기준 편집·치환 대상 텍스트 필드(D~G열) 목록 */
export function listTextFieldsForQa(): { cell: string; label: string; multiline: boolean }[] {
    const out: { cell: string; label: string; multiline: boolean }[] = [];

    for (const section of CONFIG.sections) {
        for (const field of section.fields) {
            out.push({
                cell: field.cell,
                label: field.label,
                multiline: field.multiline,
            });
        }
    }

    return out;
}

/** QA 모듈에서 쓰는 ignoreValues */
export function getIgnoreValues(): string[] {
    return CONFIG.ignoreValues;
}
