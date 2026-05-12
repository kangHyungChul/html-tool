import { escapeHtml, escapeHtmlWithLineBreak } from "./escapeHtml";
import type { CellValueMap } from "../types/cellMapConfig.types";

export interface GenerateHtmlParams {
    template: string;
    data: CellValueMap;
    /**
     * 셀 주소별로 줄바꿈을 `<br />`로 넣을지 여부.
     * JSON `fields[].multiline`에서 생성한다.
     */
    multilineByCell: Record<string, boolean>;
}

/**
 * HTML 템플릿 내 `{D6}` 같은 placeholder를 `data`의 현재 값으로 치환한다.
 * - 값은 HTML escape 처리( XSS 방지 )
 * - multiline이 true인 셀만 `\n` → `<br />` (escape 이후)
 * - 템플릿에만 있고 data에 없는 셀은 빈 문자열로 치환
 *
 * 정규식 `\{([A-Z]+[0-9]+)\}`:
 * - 컬럼은 대문자 A~Z만 허용(CONTEXT 규칙과 동일한 단순 주소만 지원).
 * - 소문자 `{d6}` 등은 의도적으로 치환하지 않는다(오타 방지 및 템플릿 내 중괄호 리터럴과의 혼동 방지).
 */
export function generateHtmlByCellPlaceholders(params: GenerateHtmlParams): string {
    const { template, data, multilineByCell } = params;

    return template.replace(/\{([A-Z]+[0-9]+)\}/g, (_match, cell: string) => {
        const value = data[cell] ?? "";
        const useLineBreak = multilineByCell[cell] === true;

        return useLineBreak ? escapeHtmlWithLineBreak(value) : escapeHtml(value);
    });
}
