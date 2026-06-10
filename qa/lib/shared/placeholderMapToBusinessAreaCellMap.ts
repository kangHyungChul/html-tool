/**
 * `business-area-template.placeholder-map.config.json`(excel-cell-placeholder)을
 * 앱이 기대하는 `BusinessAreaCellMapConfig`(sections + excel 메타)로 변환한다.
 * - 매핑 JSON은 **한 종류**(placeholder-map)만 유지하고, UI·엑셀 검증은 이 어댑터를 거친다.
 * - C열 등 레이블 셀은 `allConfiguredCellAddresses`에만 포함하고, 우측 편집 패널 sections 는 D~G열만 둔다.
 */

import type {
    BusinessAreaCellMapConfig,
    BusinessAreaFieldConfig,
    BusinessAreaSectionConfig,
    PlaceholderMapConfig,
    PlaceholderMapField,
} from "./cellMapConfig.types";

/** 카피덱 그리드 열 → 솔루션 섹션 키(템플릿 `data-hq-panel-id` 와 동일 계열) */
const COLUMN_TO_SECTION: { col: string; key: string; label: string }[] = [
    { col: "D", key: "ecoSolution", label: "Eco Solution" },
    { col: "E", key: "vehicleSolution", label: "Vehicle Solution" },
    { col: "F", key: "mediaEntertainmentSolution", label: "Media Entertainment Solution" },
    { col: "G", key: "homeApplianceSolution", label: "Home Appliance Solution" },
];

/** 기존 `businessAreaCellMap.config.json` 의 `excel.accordionRowGroups` 와 동일(행 번호 1-based) */
const ACCORDION_ROW_GROUPS = [
    { index: 1, title: 9, headline: 10, body: 11, ctaStart: 12, ctaEnd: 16 },
    { index: 2, title: 17, headline: 18, body: 19, ctaStart: 20, ctaEnd: 23 },
    { index: 3, title: 24, headline: 25, body: 26, ctaStart: 27, ctaEnd: 29 },
    { index: 4, title: 30, headline: 31, body: 32, ctaStart: 33, ctaEnd: 34 },
    { index: 5, title: 35, headline: 36, body: 37, ctaStart: 38, ctaEnd: 42 },
] as const;

const MAIN_ROWS: Record<number, string> = {
    4: "tabName",
    5: "eyebrow",
    6: "headline",
    7: "body",
    8: "disclaimer",
};

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/**
 * 행 번호(1-based) → 기존 필드 `key` 접미사(`tabName`, `accordion01.title` …)와 동일 규칙.
 *
 * @param row 1-based Excel row
 */
function semanticKeyFromRow(row: number): string {
    const main = MAIN_ROWS[row];
    if (main) {
        return main;
    }

    for (const g of ACCORDION_ROW_GROUPS) {
        const ap = `accordion${pad2(g.index)}`;
        if (row === g.title) {
            return `${ap}.title`;
        }
        if (row === g.headline) {
            return `${ap}.headline`;
        }
        if (row === g.body) {
            return `${ap}.body`;
        }
        if (row >= g.ctaStart && row <= g.ctaEnd) {
            const ctaIdx = row - g.ctaStart + 1;
            return `${ap}.cta${pad2(ctaIdx)}`;
        }
    }

    return `row${row}`;
}

/**
 * `ecoSolution.tabName` 형태의 고유 `key` (React key·기존 JSON 과 동일 패턴).
 */
function makeFieldKey(sectionKey: string, row: number): string {
    return `${sectionKey}.${semanticKeyFromRow(row)}`;
}

/**
 * 편집 UI `group` 접미사: main | accordion01 | …
 *
 * @param semantic `semanticKeyFromRow` 결과
 */
function inferGroup(semantic: string): string {
    if (
        semantic === "tabName" ||
        semantic === "eyebrow" ||
        semantic === "headline" ||
        semantic === "body" ||
        semantic === "disclaimer"
    ) {
        return "main";
    }
    const m = semantic.match(/^accordion(\d+)\./);
    if (m) {
        return `accordion${pad2(Number(m[1]))}`;
    }
    return "extra";
}

/**
 * 우측 패널에 보일 사람이 읽기 쉬운 라벨.
 *
 * @param sectionLabel 예: Eco Solution
 * @param semantic 예: accordion01.title
 */
function buildEditorLabel(sectionLabel: string, semantic: string): string {
    const human: Record<string, string> = {
        tabName: "Tab Name",
        eyebrow: "Eyebrow",
        headline: "Main Headline",
        body: "Main Body",
        disclaimer: "Disclaimer",
    };
    if (human[semantic]) {
        return `${sectionLabel} / ${human[semantic]}`;
    }

    const parts = semantic.split(".");
    if (parts.length === 2 && parts[0].toLowerCase().startsWith("accordion")) {
        const idxRaw = parts[0].replace(/^accordion/i, "");
        const head = `Accordion ${idxRaw}`;
        const p2 = parts[1];
        if (p2 === "title") {
            return `${sectionLabel} / ${head} / Title`;
        }
        if (p2 === "headline") {
            return `${sectionLabel} / ${head} / Headline`;
        }
        if (p2 === "body") {
            return `${sectionLabel} / ${head} / Body`;
        }
        if (p2.toLowerCase().startsWith("cta")) {
            const n = p2.replace(/^cta/i, "");
            return `${sectionLabel} / ${head} / CTA ${n.padStart(2, "0")}`;
        }
    }

    return `${sectionLabel} / ${semantic}`;
}

function parseRow(cell: string): number {
    const m = cell.replace(/\$/g, "").toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!m) {
        return -1;
    }
    return Number.parseInt(m[2], 10);
}

function parseCol(cell: string): string {
    const m = cell.replace(/\$/g, "").toUpperCase().match(/^([A-Z]+)(\d+)$/);
    return m ? m[1] : "";
}

/**
 * D~G 열 필드만 모아 한 섹션을 만든다.
 *
 * @param sectionKey 솔루션 키
 * @param sectionLabel 솔루션 표시명
 * @param col 단일 열 문자 (D/E/F/G)
 * @param flat `placeholder-map` 최상위 `fields`
 */
function buildSection(
    sectionKey: string,
    sectionLabel: string,
    col: string,
    flat: PlaceholderMapField[],
): BusinessAreaSectionConfig {
    const colU = col.toUpperCase();
    const rows = flat
        .filter((f) => parseCol(f.cell) === colU)
        .map((f) => ({ f, row: parseRow(f.cell) }))
        .filter((x) => x.row > 0)
        .sort((a, b) => a.row - b.row);

    const fields: BusinessAreaFieldConfig[] = rows.map(({ f, row }) => {
        const semantic = semanticKeyFromRow(row);
        return {
            cell: f.cell.replace(/\$/g, "").toUpperCase(),
            placeholder: f.placeholder ?? `{${f.cell}}`,
            key: makeFieldKey(sectionKey, row),
            label: buildEditorLabel(sectionLabel, semantic),
            group: inferGroup(semantic),
            inputType: f.inputType === "textarea" ? "textarea" : "text",
            required: Boolean(f.required),
            multiline: Boolean(f.multiline),
            initialValue: f.value ?? "",
        };
    });

    return {
        key: sectionKey,
        label: sectionLabel,
        column: colU,
        fields,
    };
}

export interface AdaptedPlaceholderRuntime {
    cellMap: BusinessAreaCellMapConfig;
    /** 시트 범위 검증에 사용( C열 레이블 등 포함 ) */
    allConfiguredCellAddresses: string[];
}

/**
 * placeholder-map JSON → 런타임용 `BusinessAreaCellMapConfig` + 전체 셀 주소 목록.
 */
export function adaptPlaceholderMapToCellMap(cfg: PlaceholderMapConfig): AdaptedPlaceholderRuntime {
    const flat = Array.isArray(cfg.fields) ? cfg.fields : [];
    const sheetNameGuess =
        cfg.sheets?.[0]?.sheetName ?? flat[0]?.sheetName ?? "Business Area";

    const sections: BusinessAreaSectionConfig[] = COLUMN_TO_SECTION.map(({ col, key, label }) =>
        buildSection(key, label, col, flat),
    );

    const allConfiguredCellAddresses = [
        ...new Set(
            flat
                .map((f) => f.cell.replace(/\$/g, "").toUpperCase())
                .filter((c) => /^[A-Z]+\d+$/.test(c)),
        ),
    ];

    const cellMap: BusinessAreaCellMapConfig = {
        version: cfg.version,
        sourceSheet: sheetNameGuess,
        mappingType: "cell-placeholder",
        description:
            "Adapted from business-area-template.placeholder-map.config.json (excel-cell-placeholder source).",
        placeholderPattern: cfg.placeholderPattern ?? "\\{([A-Z]+[0-9]+)\\}",
        ignoreValues: cfg.options?.ignoreValues ?? ["", "N/A"],
        emptyValuePolicy: "empty-string",
        excel: {
            tabColumns: {
                ecoSolution: "D",
                vehicleSolution: "E",
                mediaEntertainmentSolution: "F",
                homeApplianceSolution: "G",
            },
            mainRows: {
                tabName: 4,
                eyebrow: 5,
                headline: 6,
                body: 7,
                disclaimer: 8,
            },
        },
        sections,
    };

    return { cellMap, allConfiguredCellAddresses };
}
