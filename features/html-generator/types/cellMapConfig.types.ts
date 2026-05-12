/**
 * businessAreaCellMap.config.json 구조를 TypeScript로 표현한다.
 * JSON 스키마 전체를 엄밀히 재현하지 않고, 이 앱에서 읽는 필드만 정의한다.
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
