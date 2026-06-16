import path from "node:path";

import type { BusinessAreaCellMapConfig, PlaceholderMapConfig } from "./shared/cellMapConfig.types";
import { adaptPlaceholderMapToCellMap } from "./shared/placeholderMapToBusinessAreaCellMap";
import { loadPlaceholderMapJson } from "./assets";
import { getQaConfig } from "./qaConfig";
import { QA_PACKAGE_ROOT } from "./projectRoot";

interface CellMapBundle {
    cellMap: BusinessAreaCellMapConfig;
    allConfiguredCellAddresses: string[];
}

let cached: CellMapBundle | null = null;

/** placeholder-map·excel config 변경 후 캐시 초기화 (테스트·UI 연동용) */
export function resetQaCellMapConfigCache(): void {
    cached = null;
}

/** qa.config.excel.placeholderMapPath 기준 셀 매핑 CONFIG + config 파싱 옵션 반영 */
export function getQaCellMapBundle(): CellMapBundle {
    if (cached) {
        return cached;
    }

    const excelConfig = getQaConfig().excel;
    const json = loadPlaceholderMapJson(excelConfig.placeholderMapPath);
    const adapted = adaptPlaceholderMapToCellMap(json as PlaceholderMapConfig);

    /** ignoreValues 등 QA 파싱 정책은 qa.config 가 placeholder-map JSON 보다 우선 */
    adapted.cellMap.ignoreValues = [...excelConfig.ignoreValues];

    cached = {
        cellMap: adapted.cellMap,
        allConfiguredCellAddresses: adapted.allConfiguredCellAddresses,
    };
    return cached;
}

/** placeholder-map 절대 경로 (디버그·로그용) */
export function resolvePlaceholderMapAbsolutePath(relativePath?: string): string {
    const rel = relativePath ?? getQaConfig().excel.placeholderMapPath;
    return path.resolve(QA_PACKAGE_ROOT, rel);
}
