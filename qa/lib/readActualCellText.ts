import type { Locator, Page } from "playwright";

import type { CellTextReadFrom } from "./cellTextRead";
import { getQaConfig } from "./qaConfig";
import { normalizeForCompare, normalizeValue } from "./normalizeText";

/**
 * 비교군에서 잡은 상대 셀렉터 위치에서 실제 값을 읽는다.
 * @param readFrom — baseline 매핑 시 확정한 읽기 경로 (aria-label 셀은 innerText 와 별개)
 */
export async function readTextAtRelativeSelector(
    scope: Locator,
    relativeSelector: string,
    readFrom: CellTextReadFrom = "text",
): Promise<string> {
    const locator = scope.locator(relativeSelector);
    const count = await locator.count();

    if (count === 0) {
        return "(해당 위치 요소 없음)";
    }

    const texts: string[] = [];
    for (let i = 0; i < count; i += 1) {
        const el = locator.nth(i);
        let raw = "";

        if (readFrom === "aria-label") {
            raw = (await el.getAttribute("aria-label")) ?? "";
        } else if (readFrom === "alt") {
            raw = (await el.getAttribute("alt")) ?? "";
            if (!raw.trim()) {
                /** video 등은 alt 대신 aria-label 에 카피가 들어감 */
                raw = (await el.getAttribute("aria-label")) ?? "";
            }
        } else {
            const tag = await el.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
            if (tag === "img") {
                raw = (await el.getAttribute("alt")) ?? "";
            } else {
                raw = await el.innerText().catch(() => "");
                if (!raw.trim()) {
                    raw = (await el.textContent()) ?? "";
                }
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

/** scope 없을 때 페이지 `.business-area` 에서 시도 */
export async function readTextAtRelativeSelectorOnPage(
    page: Page,
    relativeSelector: string,
    readFrom: CellTextReadFrom = "text",
): Promise<string> {
    const rootSelector = getQaConfig().page.businessAreaRootSelector;
    const scope = page.locator(rootSelector).first();
    if ((await scope.count()) === 0) {
        return "(Business Area 없음)";
    }
    return readTextAtRelativeSelector(scope, relativeSelector, readFrom);
}

/** 디버그·비교용 — 읽은 값 정규화 */
export function normalizeReadValue(raw: string): string {
    return normalizeForCompare(raw);
}
