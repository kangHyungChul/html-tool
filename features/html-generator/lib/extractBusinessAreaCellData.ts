import { utils } from "xlsx";
import type { CellObject, Range, WorkBook, WorkSheet } from "xlsx";

import cellMapConfig from "../constants/businessAreaCellMap.config.json";
import type { BusinessAreaCellMapConfig, CellValueMap } from "../types/cellMapConfig.types";

const embeddedConfig = cellMapConfig as BusinessAreaCellMapConfig;

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

/** 검증 실패 시 내부 구분용 코드(null 이면 통과) */
type SheetInvalidReason =
    | null
    | "no_ref"
    | "bad_ref"
    | { kind: "cell_out_of_range"; addr: string; ref: string }
    | { kind: "empty_tab_name"; tabRowAddrs: string };

/**
 * 카피덱 Business Area 그리드와 호환되는지 검사한다(throw 없음).
 *
 * 기준:
 * 1. `!ref` 존재
 * 2. JSON 매핑 셀이 모두 범위 안
 * 3. 탭명 행 칸이 모두 비어 있지 않음(ignoreValues 정규화 후)
 */
function getBusinessAreaSheetInvalidReason(
    sheet: WorkSheet,
    cfg: BusinessAreaCellMapConfig,
): SheetInvalidReason {
    const ref = sheet["!ref"];
    if (!ref || typeof ref !== "string") {
        return "no_ref";
    }

    let range: Range;
    try {
        range = utils.decode_range(ref);
    } catch {
        return "bad_ref";
    }

    const addresses = collectConfiguredCells(cfg);
    for (const addr of addresses) {
        if (!cellAddressWithinRange(addr, range)) {
            return { kind: "cell_out_of_range", addr, ref };
        }
    }

    const tabRowCells = getTabNameRowCellAddresses(cfg);
    for (const addr of tabRowCells) {
        const raw = readCellAsString(sheet, addr).trim();
        const normalized = applyIgnorePolicy(raw, cfg.ignoreValues);
        if (normalized === "") {
            return { kind: "empty_tab_name", tabRowAddrs: tabRowCells.join(", ") };
        }
    }

    return null;
}

/**
 * 시트가 Business Area 카피덱 양식에 맞는지 여부(워크북 전체 스캔 시 스킵 판별용).
 */
export function isBusinessAreaSheet(sheet: WorkSheet, cfg: BusinessAreaCellMapConfig): boolean {
    return getBusinessAreaSheetInvalidReason(sheet, cfg) === null;
}

/**
 * 양식 검증에 실패하면 Error를 던진다. (단일 시트 업로드 실패 메시지용)
 */
function validateBusinessAreaSheetOrThrow(
    sheet: WorkSheet,
    cfg: BusinessAreaCellMapConfig,
    sheetName: string,
): void {
    const reason = getBusinessAreaSheetInvalidReason(sheet, cfg);
    if (reason === null) {
        return;
    }

    if (reason === "no_ref") {
        throw new Error(
            `시트「${sheetName}」의 데이터 범위(!ref)를 찾을 수 없습니다. 엑셀에서 파일을 열어 다시 저장한 뒤 업로드해 주세요.`,
        );
    }

    if (reason === "bad_ref") {
        throw new Error(
            `시트「${sheetName}」의 범위 정보가 올바르지 않습니다. 파일이 손상되지 않았는지 확인해 주세요.`,
        );
    }

    if (reason.kind === "cell_out_of_range") {
        throw new Error(
            `양식이 맞지 않습니다. 매핑에 필요한 셀 ${reason.addr}이(가) 시트「${sheetName}」의 사용 범위(${reason.ref}) 안에 없습니다. 카피덱 그리드(D~G열 등)가 빠짐없이 들어 있는지 확인해 주세요.`,
        );
    }

    throw new Error(
        `양식이 맞지 않습니다. 탭명 행(${reason.tabRowAddrs})에 비어 있는 칸이 있습니다. 시트「${sheetName}」가 이 도구가 기대하는 카피덱 형식인지 확인해 주세요.`,
    );
}

/**
 * 검증을 통과한 시트에서만 호출한다. 설정에 나열된 셀만 읽어 CellValueMap을 만든다.
 * - N/A 및 ignoreValues → 빈 문자열
 * - 빈 셀 → 빈 문자열
 */
export function extractCellDataFromSheet(
    sheet: WorkSheet,
    cfg: BusinessAreaCellMapConfig,
): CellValueMap {
    const addresses = collectConfiguredCells(cfg);
    const result: CellValueMap = {};

    for (const addr of addresses) {
        const raw = readCellAsString(sheet, addr);
        const normalized = applyIgnorePolicy(raw, cfg.ignoreValues);
        result[addr] = normalized;
    }

    return result;
}

export interface ListedBusinessAreaSheet {
    /** 워크북의 시트 이름(탭 라벨에 사용) */
    sheetName: string;
    /** ignoreValues 적용 직후 추출 맵(mergeExtractedWithInitialFallback 전 단계) */
    extracted: CellValueMap;
}

/**
 * 워크북의 모든 시트를 순서대로 보며, 양식에 맞는 시트만 추출한다.
 * 맞지 않는 시트는 조용히 건너뛴다.
 */
export function listBusinessAreaSheetsFromWorkbook(
    workbook: WorkBook,
    cfg: BusinessAreaCellMapConfig = embeddedConfig,
): ListedBusinessAreaSheet[] {
    const names = workbook.SheetNames;
    if (!names || names.length === 0) {
        return [];
    }

    const out: ListedBusinessAreaSheet[] = [];

    for (const sheetName of names) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            continue;
        }
        if (!isBusinessAreaSheet(sheet, cfg)) {
            continue;
        }
        out.push({
            sheetName,
            extracted: extractCellDataFromSheet(sheet, cfg),
        });
    }

    return out;
}

/**
 * 워크북 **첫 번째 시트**만 검증·추출한다. 양식 오류 시 Error.
 * (하위 호환·단일 시트 스크립트용; UI는 `listBusinessAreaSheetsFromWorkbook` 사용 권장)
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

    validateBusinessAreaSheetOrThrow(sheet, embeddedConfig, sheetName);
    return extractCellDataFromSheet(sheet, embeddedConfig);
}
