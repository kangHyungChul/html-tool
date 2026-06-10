import type { Locator, Page } from "playwright";

import { getCellDomSelector } from "./cellDomSelectors";
import { normalizeValue } from "./normalizeText";

/**
 * 실패한 번역 셀의 **페이지 실제 텍스트**를 읽는다.
 * - 템플릿 placeholder 위치 기반 셀렉터 사용
 */
export async function readActualTextForCell(scope: Locator, cell: string): Promise<string> {
    const selector = getCellDomSelector(cell);
    if (!selector) {
        return "(셀 DOM 위치 매핑 없음)";
    }

    const relative = selector.replace(/^\.business-area\s*/, "");
    const locator = scope.locator(relative);
    const count = await locator.count();

    if (count === 0) {
        return "(해당 위치 요소 없음)";
    }

    const texts: string[] = [];
    for (let i = 0; i < count; i += 1) {
        const el = locator.nth(i);
        const tag = await el.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");

        let raw = "";
        if (tag === "img") {
            raw = (await el.getAttribute("alt")) ?? "";
        } else {
            raw = await el.innerText().catch(() => "");
            if (!raw.trim()) {
                raw = (await el.getAttribute("aria-label")) ?? (await el.textContent()) ?? "";
            }
        }

        const trimmed = normalizeValue(raw);
        if (trimmed) {
            texts.push(trimmed);
        }
    }

    const unique = [...new Set(texts)];
    if (unique.length === 0) {
        return "(비어 있음)";
    }
    if (unique.length === 1) {
        return unique[0];
    }
    return unique.join(" | ");
}

/** scope 없을 때 페이지 전체에서 시도 */
export async function readActualTextForCellOnPage(page: Page, cell: string): Promise<string> {
    const scope = page.locator(".business-area").first();
    if ((await scope.count()) === 0) {
        return "(Business Area 없음)";
    }
    return readActualTextForCell(scope, cell);
}
