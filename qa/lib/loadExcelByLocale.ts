import { read, type WorkSheet } from "xlsx";

import { getQaCellMapBundle } from "./cellMapConfigLoader";
import { getQaConfig } from "./qaConfig";
import {
    extractCellDataFromSheet,
    isBusinessAreaSheet,
} from "./shared/extractBusinessAreaCellData";
import type { CellValueMap } from "./shared/cellMapConfig.types";

/** 버퍼에서 SheetJS Workbook 로드 — `qa.config.excel.parse` 적용 */
export function loadWorkbookFromBuffer(buffer: Buffer): import("xlsx").WorkBook {
    const { cellDates } = getQaConfig().excel.parse;
    return read(buffer, { type: "buffer", cellDates });
}

/**
 * locale-map 키와 1:1 매칭되는 시트를 찾는다.
 * - `exact-then-prefix`: exact → `ca_en` → `ca` 접두어 재시도
 * - `exact-only`: exact 만
 */
export function resolveSheetNameForLocaleKey(
    workbook: import("xlsx").WorkBook,
    localeKey: string,
): string | null {
    const names = workbook.SheetNames ?? [];
    if (names.length === 0) {
        return null;
    }

    const normalizedKey = localeKey.trim().toLowerCase();
    const { localeSheetResolve } = getQaConfig().excel;

    const exact = names.find((name) => name.trim().toLowerCase() === normalizedKey);
    if (exact) {
        return exact;
    }

    if (localeSheetResolve === "exact-then-prefix") {
        const underscore = normalizedKey.indexOf("_");
        if (underscore > 0) {
            const prefix = normalizedKey.slice(0, underscore);
            const byPrefix = names.find((name) => name.trim().toLowerCase() === prefix);
            if (byPrefix) {
                return byPrefix;
            }
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

    const CONFIG = getQaCellMapBundle().cellMap;
    const { validateSheetLayout } = getQaConfig().excel;

    if (validateSheetLayout && !isBusinessAreaSheet(sheet, CONFIG)) {
        throw new Error(`시트「${sheetName}」가 Business Area 카피덱 양식과 맞지 않습니다.`);
    }

    return {
        sheetName,
        cellMap: extractCellDataFromSheet(sheet, CONFIG),
    };
}

/** placeholder-map 기준 편집·치환 대상 텍스트 필드(D~G열) 목록 */
export function listTextFieldsForQa(): { cell: string; label: string; multiline: boolean }[] {
    const CONFIG = getQaCellMapBundle().cellMap;
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

/** QA 모듈에서 쓰는 ignoreValues — `qa.config.excel.ignoreValues` */
export function getIgnoreValues(): string[] {
    return [...getQaConfig().excel.ignoreValues];
}
