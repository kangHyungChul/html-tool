/**
 * Business Area 매핑 JSON 타입.
 * - **소스 파일**: `business-area-template.placeholder-map.config.json` (`PlaceholderMapConfig`)
 * - **런타임 UI·검증**: `adaptPlaceholderMapToCellMap()` 이 만든 `BusinessAreaCellMapConfig` (sections 등)
 */

export type CellAddress = string;

/** 엑셀 셀 주소 → 화면/치환에 쓰는 문자열 값 */
export type CellValueMap = Record<CellAddress, string>;

export type FieldInputType = "text" | "textarea";

/**
 * 우측 편집 패널 한 줄에 대응하는 필드 정의.
 * `cell`이 HTML 템플릿의 `{D6}` placeholder와 동일한 키로 연결된다.
 */
export interface BusinessAreaFieldConfig {
    cell: CellAddress;
    placeholder: string;
    key: string;
    label: string;
    group: string;
    inputType: FieldInputType;
    required: boolean;
    /** true면 줄바꿈을 `<br />`로 삽입(escape 후) */
    multiline: boolean;
    initialValue?: string;
}

export interface BusinessAreaSectionConfig {
    key: string;
    label: string;
    column: string;
    fields: BusinessAreaFieldConfig[];
}

export interface BusinessAreaCellMapConfig {
    version: string;
    sourceSheet: string;
    mappingType: string;
    description?: string;
    placeholderPattern?: string;
    /** 이 목록과 일치하는 값은 빈 문자열로 취급(예: N/A) */
    ignoreValues: string[];
    emptyValuePolicy?: string;
    /** 카피덱 엑셀 레이아웃 메타(탭명 행·열). 양식 검증에 사용 */
    excel?: {
        tabColumns: Record<string, string>;
        mainRows: Record<string, number>;
    };
    sections: BusinessAreaSectionConfig[];
}

/** `business-area-template.placeholder-map.config.json` 한 필드 (excel-cell-placeholder) */
export interface PlaceholderMapField {
    sheetName: string;
    cell: CellAddress;
    placeholder: string;
    label: string;
    value: string;
    htmlContext: string;
    inputType: FieldInputType;
    required: boolean;
    multiline: boolean;
    status?: string;
    ignored?: boolean;
}

export interface PlaceholderMapSheet {
    sheetName: string;
    range: string;
    fields: PlaceholderMapField[];
}

/** 엑셀 시트에서 «상단 타이틀/메타» 행을 JSON·코드에서 구분하기 위한 메타(선택) */
export interface PlaceholderMapExcelLayout {
    /**
     * 카피덱 상단: Category, Tab_xx, Copy-text 등이 있는 행(1-based, inclusive).
     * 본문 카피는 보통 그 아래(예: 4행 `Main-content`부터)에 둔다.
     */
    sheetTitleRowRange: {
        startRow: number;
        endRow: number;
    };
    /** 본문 블록이 시작하는 첫 행(1-based). 시트 `range` 하한과 맞추면 된다. */
    mainContentFirstRow?: number;
}

/** 엑셀 스캔·html-to-cell 스크립트가 쓰는 매핑 JSON 루트 */
export interface PlaceholderMapConfig {
    version: string;
    mappingType: string;
    placeholderPattern?: string;
    source: { excelFile: string };
    options: {
        ignoreValues: string[];
        includeIgnoredValues?: boolean;
        useFormattedCellValue?: boolean;
    };
    /** 시트 상단 타이틀 영역 행 범위 등(없으면 코드에서 기본 2~3행 사용) */
    excelLayout?: PlaceholderMapExcelLayout;
    sheets: PlaceholderMapSheet[];
    fields: PlaceholderMapField[];
    ambiguousItems?: unknown[];
    unmappedHtmlTexts?: unknown[];
    unusedExcelCells?: unknown[];
    questions?: unknown[];
}
