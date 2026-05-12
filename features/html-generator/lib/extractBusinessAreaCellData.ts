import { utils } from "xlsx";
import type { CellObject, Range, WorkBook, WorkSheet } from "xlsx";

import cellMapConfig from "../constants/businessAreaCellMap.config.json";
import type { BusinessAreaCellMapConfig, CellValueMap } from "../types/cellMapConfig.types";

const config = cellMapConfig as BusinessAreaCellMapConfig;

/**
 * 시트에서 단일 셀을 읽어 문자열로 정규화한다.
 * - 빈 셀, 타입 z(스텁) → 빈 문자열
 * - 숫자/날짜 등은 format_cell로 사람이 보는 형태에 가깝게 문자열화
 *
 * 병합 셀 주의:
 * - 엑셀에서 병합된 범위는 “좌상단 마스터 셀”에만 값이 있고 나머지는 비어 있는 경우가 많다.
 * - 카피덱 구조가 병합을 쓰면, JSON에 정의한 주소가 마스터가 아닐 경우 빈 값이 나올 수 있다.
 */
function readCellAsString(sheet: WorkSheet, cellAddress: string): string {
    const addr = cellAddress.replace(/\$/g, "").toUpperCase();
    const cell = sheet[addr] as CellObject | undefined;

    if (!cell || cell.t === "z") {
        return "";
    }

    if (cell.v === undefined || cell.v === null) {
        return "";
    }

    try {
        return String(utils.format_cell(cell) ?? "");
    } catch {
        return String(cell.w ?? cell.v ?? "");
    }
}

/**
 * `ignoreValues`(예: N/A)에 해당하면 빈 문자열로 바꾼다.
 */
function applyIgnorePolicy(value: string, ignoreValues: string[]): string {
    for (const ignored of ignoreValues) {
        if (value === ignored) {
            return "";
        }
    }
    return value;
}

/**
 * JSON에 정의된 모든 `sections[].fields[].cell`을 수집한다.
 * (동일 셀이 중복 정의되면 Set으로 한 번만 읽는다.)
 */
function collectConfiguredCells(cfg: BusinessAreaCellMapConfig): string[] {
    const cells = new Set<string>();
    for (const section of cfg.sections) {
        for (const field of section.fields) {
            cells.add(field.cell);
        }
    }
    return [...cells];
}

/**
 * JSON `excel.tabColumns` + `excel.mainRows.tabName`으로 탭명 행 셀 주소 목록을 만든다.
 * 메타가 없으면 CONTEXT 기본(D~G, 4행)을 사용한다.
 */
function getTabNameRowCellAddresses(cfg: BusinessAreaCellMapConfig): string[] {
    const row = cfg.excel?.mainRows?.tabName ?? 4;
    const tabCols = cfg.excel?.tabColumns;
    if (tabCols && typeof tabCols === "object") {
        return Object.values(tabCols).map((col) => `${String(col).toUpperCase()}${row}`);
    }
    return ["D4", "E4", "F4", "G4"];
}

/**
 * 셀이 시트의 사용 범위(!ref로 디코드한 range) 안에 있는지 검사한다.
 */
function cellAddressWithinRange(cellAddress: string, range: Range): boolean {
    const { r, c } = utils.decode_cell(cellAddress.replace(/\$/g, "").toUpperCase());
    return r >= range.s.r && r <= range.e.r && c >= range.s.c && c <= range.e.c;
}

/**
 * 업로드된 **첫 번째 시트**가 이 도구가 기대하는 카피덱 그리드와 호환되는지 가볍게 검증한다.
 *
 * 검증 기준(성능·오탐 균형):
 * 1. `!ref` 존재: 시트 사용 범위를 알 수 있어야 함.
 * 2. JSON에 정의된 모든 매핑 셀이 `!ref` 범위 안에 있어야 함(그리드가 잘리지 않았는지).
 * 3. 탭명 행(D4~G4 등 `excel` 메타 기준): 네 칸 모두 비어 있지 않아야 함(빈 시트·다른 양식 걸러냄).
 *
 * 하지 않는 것(애매·오탐 가능): 탭 문자열을 “Eco Solution” 등과 정확히 일치시키지 않음(언어·개정 대응).
 */
function validateFirstSheetBusinessAreaFormat(
    sheet: WorkSheet,
    cfg: BusinessAreaCellMapConfig,
    firstSheetName: string,
): void {
    const ref = sheet["!ref"];
    if (!ref || typeof ref !== "string") {
        throw new Error(
            "첫 번째 시트의 데이터 범위(!ref)를 찾을 수 없습니다. 엑셀에서 파일을 열어 다시 저장한 뒤 업로드해 주세요.",
        );
    }

    let range: Range;
    try {
        range = utils.decode_range(ref);
    } catch {
        throw new Error("첫 번째 시트의 범위 정보가 올바르지 않습니다. 파일이 손상되지 않았는지 확인해 주세요.");
    }

    const addresses = collectConfiguredCells(cfg);
    for (const addr of addresses) {
        if (!cellAddressWithinRange(addr, range)) {
            throw new Error(
                `양식이 맞지 않습니다. 매핑에 필요한 셀 ${addr}이(가) 첫 번째 시트「${firstSheetName}」의 사용 범위(${ref}) 안에 없습니다. 첫 번째 시트에 카피덱 그리드(D~G열 등)가 빠짐없이 들어 있는지 확인해 주세요.`,
            );
        }
    }

    const tabRowCells = getTabNameRowCellAddresses(cfg);
    for (const addr of tabRowCells) {
        const raw = readCellAsString(sheet, addr).trim();
        const normalized = applyIgnorePolicy(raw, cfg.ignoreValues);
        if (normalized === "") {
            throw new Error(
                `양식이 맞지 않습니다. 탭명 행(${tabRowCells.join(", ")})에 비어 있는 칸이 있습니다. 첫 번째 시트「${firstSheetName}」가 이 도구가 기대하는 카피덱 형식(탭명 행 등)인지 확인해 주세요.`,
            );
        }
    }
}

/**
 * 업로드된 엑셀의 **첫 번째 시트**에서 설정 JSON에 나열된 셀만 읽어 CellValueMap을 만든다.
 * - 시트 이름은 보지 않는다(“Business Area”가 아니어도 첫 시트만 사용).
 * - 양식 검증에 실패하면 Error를 던진다.
 * - N/A 및 ignoreValues → 빈 문자열
 * - 빈 셀 → 빈 문자열
 * - 최종 값은 모두 string
 */
export function extractBusinessAreaCellData(workbook: WorkBook): CellValueMap {
    const names = workbook.SheetNames;
    if (!names || names.length === 0) {
        throw new Error("엑셀 파일에 시트가 없습니다.");
    }

    const sheetName = names[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
        throw new Error(`첫 번째 시트「${sheetName}」를 읽을 수 없습니다.`);
    }

    validateFirstSheetBusinessAreaFormat(sheet, config, sheetName);

    const addresses = collectConfiguredCells(config);
    const result: CellValueMap = {};

    for (const addr of addresses) {
        const raw = readCellAsString(sheet, addr);
        const normalized = applyIgnorePolicy(raw, config.ignoreValues);
        result[addr] = normalized;
    }

    return result;
}
