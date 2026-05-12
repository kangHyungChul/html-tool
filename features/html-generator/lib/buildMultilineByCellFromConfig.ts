import type { BusinessAreaCellMapConfig } from "../types/cellMapConfig.types";

/**
 * JSON 설정에서 셀 주소 → multiline(줄바꿈 `<br />` 허용) 맵을 만든다.
 * 동일 `cell`이 여러 필드에 반복되면, JSON 배열 순서상 **나중** 필드 정의가 우선한다.
 * (실무적으로는 한 셀당 한 필드만 두는 구성이 일반적이다.)
 */
export function buildMultilineByCellFromConfig(
    cfg: BusinessAreaCellMapConfig,
): Record<string, boolean> {
    const map: Record<string, boolean> = {};

    for (const section of cfg.sections) {
        for (const field of section.fields) {
            map[field.cell] = field.multiline === true;
        }
    }

    return map;
}
