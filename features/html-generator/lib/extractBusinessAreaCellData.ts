import { utils } from "xlsx";
import type { CellObject, Range, WorkBook, WorkSheet } from "xlsx";

import placeholderMapJson from "../constants/business-area-template.placeholder-map.config.json";
import type { BusinessAreaCellMapConfig, CellValueMap, PlaceholderMapConfig } from "../types/cellMapConfig.types";
import { adaptPlaceholderMapToCellMap } from "./placeholderMapToBusinessAreaCellMap";

const { cellMap: embeddedConfig, allConfiguredCellAddresses } = adaptPlaceholderMapToCellMap(
    placeholderMapJson as PlaceholderMapConfig,
);

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
 * JSON에 정의된 모든 셀 주소(placeholder-map `fields` 전체, C열 등 포함)를 수집한다.
 * 동일 셀이 중복되면 Set 으로 한 번만 남긴다.
 */
function collectConfiguredCellAddresses(): string[] {
    return allConfiguredCellAddresses;
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
    | { kind: "empty_tab_name"; tabRowAddrs: string }
    | { kind: "duplicate_tab_names"; tabRowAddrs: string }
    | { kind: "empty_required_field"; cell: string; fieldLabel: string };

/**
 * 탭명 행 “중복 검사”용 정규화(trim + 소문자).
 * - 번역어·현지어 탭명도 그대로 두고, 동일 문구가 두 열에 반복됐는지만 본다.
 */
function normalizeTabNameForDuplicateCheck(value: string): string {
    return value.trim().toLowerCase();
}

/**
 * 탭명 행(D4~G4 등)의 각 칸이 서로 다른 문자열인지 검사한다.
 * - 한 행에 동일한 탭명이 두 번 이상 나오면(대소문자 무시) 잘못된 시트로 본다.
 * - 열 순서가 바뀌어 복사되었거나, 한 열만 채워 넣은 뒤 가로로 끌어채운 경우를 걸러낸다.
 */
function tabNameRowValuesAreDistinct(
    sheet: WorkSheet,
    tabRowAddrs: string[],
    ignoreValues: string[],
): boolean {
    const seen = new Set<string>();
    for (const addr of tabRowAddrs) {
        const raw = readCellAsString(sheet, addr).trim();
        const normalized = applyIgnorePolicy(raw, ignoreValues);
        const key = normalizeTabNameForDuplicateCheck(normalized);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
    }
    return true;
}

/**
 * JSON에서 `required: true`로 표시된 모든 필드에 실제 값이 있는지 순서대로 검사한다.
 * - 빈 셀, 공백만 있는 셀, `ignoreValues`(예: N/A)로 정규화되면 빈 문자열이 되는 값 → 실패.
 * - 셀 내용의 언어는 검사하지 않는다(번역·현지어 카피 허용). 오류 메시지의 `fieldLabel`은 JSON(편집 UI용) 영문일 수 있다.
 */
function getFirstEmptyRequiredField(
    sheet: WorkSheet,
    cfg: BusinessAreaCellMapConfig,
): SheetInvalidReason {
    for (const section of cfg.sections) {
        for (const field of section.fields) {
            if (!field.required) {
                continue;
            }
            const raw = readCellAsString(sheet, field.cell).trim();
            const normalized = applyIgnorePolicy(raw, cfg.ignoreValues);
            if (normalized === "") {
                return {
                    kind: "empty_required_field",
                    cell: field.cell,
                    fieldLabel: field.label,
                };
            }
        }
    }
    return null;
}

/**
 * 카피덱 Business Area 그리드와 호환되는지 검사한다(throw 없음).
 *
 * 기준:
 * 1. `!ref` 존재·디코드 가능
 * 2. JSON 매핑 셀이 모두 사용 범위 안
 * 3. 탭명 행 칸이 모두 비어 있지 않음(ignoreValues 정규화 후)
 * 4. 탭명 행 값이 서로 중복되지 않음(대소문자 무시) — 번역·현지어 탭명 허용, 영문 JSON label과는 비교하지 않음
 * 5. `required: true` 필드가 모두 비어 있지 않음
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

    const addresses = collectConfiguredCellAddresses();
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

    if (!tabNameRowValuesAreDistinct(sheet, tabRowCells, cfg.ignoreValues)) {
        return { kind: "duplicate_tab_names", tabRowAddrs: tabRowCells.join(", ") };
    }

    const emptyRequired = getFirstEmptyRequiredField(sheet, cfg);
    if (emptyRequired !== null) {
        return emptyRequired;
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

    if (reason.kind === "empty_tab_name") {
        throw new Error(
            `양식이 맞지 않습니다. 탭명 행(${reason.tabRowAddrs})에 비어 있는 칸이 있습니다. 시트「${sheetName}」가 이 도구가 기대하는 카피덱 형식인지 확인해 주세요.`,
        );
    }

    if (reason.kind === "duplicate_tab_names") {
        throw new Error(
            `양식이 맞지 않습니다. 탭명 행(${reason.tabRowAddrs})에 서로 같은 값이 반복되어 있습니다. 열이 뒤바뀌었거나 잘못 복사되었는지 확인해 주세요. (시트「${sheetName}」)`,
        );
    }

    if (reason.kind === "empty_required_field") {
        throw new Error(
            `양식이 맞지 않습니다. 필수 항목「${reason.fieldLabel}」(셀 ${reason.cell})이 비어 있거나 N/A로 표시되어 있습니다. 시트「${sheetName}」의 내용을 채운 뒤 다시 업로드해 주세요.`,
        );
    }

    throw new Error(`시트「${sheetName}」검증에 실패했습니다. 알 수 없는 오류입니다.`);
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
    const addresses = collectConfiguredCellAddresses();
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
