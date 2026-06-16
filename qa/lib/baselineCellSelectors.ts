import type { Locator } from "playwright";

import type { CellTextReadFrom } from "./cellTextRead";
import { getIgnoreValues, listTextFieldsForQa } from "./loadExcelByLocale";
import { getQaConfig, type QaConfig } from "./qaConfig";
import { normalizeForCompare, shouldIgnoreValue } from "./normalizeText";
import { throwIfAborted } from "./businessAreaScope";

/** 셀 한 개의 DOM 위치 매핑 결과 */
export interface CellDomMapping {
    /** `.business-area` 루트 기준 상대 CSS 셀렉터 */
    relativeSelector: string;
    /** 비교군 `.business-area` 내부 DOM 텍스트 완전 일치로 확정 */
    source: "baseline-dom";
    /** locale 검증 시 읽을 속성 — D45 tablist aria-label, D8 video aria-label 등 */
    readFrom: CellTextReadFrom;
}

export interface ResolveCellSelectorsResult {
    mappings: Map<string, CellDomMapping>;
    /** 비교군 페이지에서 global 텍스트 위치를 찾지 못한 셀 */
    unresolved: { cell: string; label: string; baselineText: string; reason: string }[];
}

function panelIdForCell(cell: string, columnToPanelId: Record<string, string>): string | null {
    const col = cell.replace(/[0-9]+/g, "").toUpperCase();
    return columnToPanelId[col] ?? null;
}

/**
 * 비교군(global) `.business-area` DOM 에서 global 엑셀 텍스트가 있는 leaf 요소를 찾아
 * 검증 대상 페이지 `.business-area` 에서 재사용할 상대 셀렉터를 만든다.
 *
 * @param scope — 반드시 `page.locator('.business-area').first()` 와 동일한 루트
 */
export async function resolveCellSelectorsFromBaseline(
    scope: Locator,
    baselineCellMap: Record<string, string>,
    options?: {
        signal?: AbortSignal;
        onProgress?: (current: number, total: number) => void;
        config?: QaConfig;
    },
): Promise<ResolveCellSelectorsResult> {
    const translationConfig = (options?.config ?? getQaConfig()).translation;
    const ignoreValues = getIgnoreValues();
    const fields = listTextFieldsForQa();
    const mappings = new Map<string, CellDomMapping>();
    const unresolved: ResolveCellSelectorsResult["unresolved"] = [];

    let processed = 0;
    const total = fields.length;

    for (const field of fields) {
        throwIfAborted(options?.signal);
        processed += 1;
        options?.onProgress?.(processed, total);

        const baselineText = baselineCellMap[field.cell] ?? "";
        if (shouldIgnoreValue(baselineText, ignoreValues)) {
            continue;
        }

        const normalizedBaseline = normalizeForCompare(baselineText);

        /** Playwright evaluate — 브라우저 컨텍스트 전용 (외부 import 불가) */
        const resolved = await scope.evaluate(
            (
                root,
                {
                    normalizedBaseline,
                    panelId,
                    matchPriority,
                    stableClassPrefixes,
                    unstableIdPattern,
                }: {
                    normalizedBaseline: string;
                    panelId: string | null;
                    matchPriority: CellTextReadFrom[];
                    stableClassPrefixes: string[];
                    unstableIdPattern: string;
                },
            ) => {
                /** 텍스트 비교용 정규화 (Node 쪽 normalizeForCompare 와 동일 규칙) */
                function normalize(s: string): string {
                    return s
                        .replace(/\r\n/g, "\n")
                        .replace(/\r/g, "\n")
                        .trim()
                        .replace(/<br\s*\/?>/gi, " ")
                        .replace(/\s+/g, " ")
                        .toLowerCase();
                }

                /** 보이는 텍스트(innerText) — aria-label 과 분리 비교 */
                function readVisibleText(el: Element): string {
                    return (el as HTMLElement).innerText ?? el.textContent ?? "";
                }

                function cssEscape(value: string): string {
                    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
                        return CSS.escape(value);
                    }
                    return value.replace(/([^\w-])/g, "\\$1");
                }

                type MatchKind = "aria-label" | "alt" | "text";

                /** readFrom 종류별로 요소 값 추출 */
                function valueAt(el: Element, kind: MatchKind): string {
                    if (kind === "aria-label") {
                        return el.getAttribute("aria-label") ?? "";
                    }
                    if (kind === "alt") {
                        return el.getAttribute("alt") ?? "";
                    }
                    const tag = el.tagName.toLowerCase();
                    if (tag === "img") {
                        return el.getAttribute("alt") ?? "";
                    }
                    return readVisibleText(el);
                }

                function matchesKind(el: Element, target: string, kind: MatchKind): boolean {
                    const text = normalize(valueAt(el, kind));
                    return Boolean(text) && text === target;
                }

                /**
                 * innerText 기준 leaf — aria-label 은 자식 탭 텍스트와 무관하게 부모에 있을 수 있어
                 * text 종류에만 적용한다.
                 */
                function isLeafVisibleTextMatch(el: Element, target: string): boolean {
                    if (!matchesKind(el, target, "text")) {
                        return false;
                    }
                    for (const child of el.querySelectorAll("*")) {
                        if (matchesKind(child, target, "text")) {
                            return false;
                        }
                    }
                    return true;
                }

                function inPanel(el: Element, id: string): boolean {
                    return !!el.closest(`#${id}, [id="${id}"]`);
                }

                /** id·안정 class 우선, 없으면 형제 tag 순번으로 한 단계 셀렉터 생성 */
                function buildSegment(el: Element): string {
                    const tag = el.tagName.toLowerCase();
                    const unstableRe = new RegExp(unstableIdPattern, "i");

                    const id = el.getAttribute("id");
                    if (id && /^[a-zA-Z][\w-]*$/.test(id) && !unstableRe.test(id)) {
                        return `#${cssEscape(id)}`;
                    }

                    const stableClasses = [...el.classList].filter(
                        (c) => stableClassPrefixes.some((p) => c.startsWith(p)) && !c.includes("swiper"),
                    );

                    if (stableClasses.length > 0) {
                        const classPart = stableClasses
                            .slice(0, 2)
                            .map((c) => `.${cssEscape(c)}`)
                            .join("");
                        const parent = el.parentElement;
                        if (parent) {
                            const siblings = [...parent.children].filter(
                                (s) =>
                                    s.tagName.toLowerCase() === tag &&
                                    stableClasses.every((cl) => s.classList.contains(cl)),
                            );
                            if (siblings.length === 1) {
                                return `${tag}${classPart}`;
                            }
                            const nthChild = [...parent.children].indexOf(el) + 1;
                            return `${tag}${classPart}:nth-child(${nthChild})`;
                        }
                        return `${tag}${classPart}`;
                    }

                    const parent = el.parentElement;
                    if (!parent) {
                        return tag;
                    }
                    const sameTag = [...parent.children].filter((c) => c.tagName.toLowerCase() === tag);
                    const idx = sameTag.indexOf(el) + 1;
                    return `${tag}:nth-of-type(${idx})`;
                }

                /** `.business-area` 루트까지 상대 경로 (루트 자체는 포함하지 않음) */
                function buildRelative(el: Element, rootEl: Element): string {
                    const segments: string[] = [];
                    let node: Element | null = el;
                    while (node && node !== rootEl && node.tagName) {
                        segments.unshift(buildSegment(node));
                        node = node.parentElement;
                    }
                    return segments.join(" > ");
                }

                function collectByKind(kind: MatchKind): Element[] {
                    if (kind === "aria-label") {
                        return [...root.querySelectorAll("[aria-label]")].filter((el) =>
                            matchesKind(el, normalizedBaseline, "aria-label"),
                        );
                    }
                    if (kind === "alt") {
                        return [...root.querySelectorAll("img[alt], [alt]")].filter((el) =>
                            matchesKind(el, normalizedBaseline, "alt"),
                        );
                    }
                    return [...root.querySelectorAll("*")].filter((el) =>
                        isLeafVisibleTextMatch(el, normalizedBaseline),
                    );
                }

                const candidateGroups: { kind: MatchKind; elements: Element[] }[] = matchPriority.map(
                    (kind) => ({
                        kind,
                        elements: collectByKind(kind),
                    }),
                );

                for (const group of candidateGroups) {
                    let candidates = group.elements;
                    if (candidates.length === 0) {
                        continue;
                    }

                    if (panelId && candidates.length > 1) {
                        const inPanelCandidates = candidates.filter((el) => inPanel(el, panelId));
                        if (inPanelCandidates.length > 0) {
                            candidates = inPanelCandidates;
                        }
                    }

                    candidates.sort((a, b) => {
                        const depth = (n: Element) => {
                            let d = 0;
                            let x: Element | null = n;
                            while (x && x !== root) {
                                d += 1;
                                x = x.parentElement;
                            }
                            return d;
                        };
                        return depth(b) - depth(a);
                    });

                    for (const target of candidates) {
                        const relativeSelector = buildRelative(target, root);
                        let matched: Element[];
                        try {
                            matched = [...root.querySelectorAll(relativeSelector)];
                        } catch {
                            continue;
                        }
                        if (matched.length !== 1 || matched[0] !== target) {
                            continue;
                        }
                        if (!matchesKind(matched[0], normalizedBaseline, group.kind)) {
                            continue;
                        }
                        return {
                            relativeSelector,
                            source: "baseline-dom" as const,
                            readFrom: group.kind,
                        };
                    }
                }

                return null;
            },
            {
                normalizedBaseline,
                panelId: panelIdForCell(field.cell, translationConfig.columnToPanelId),
                matchPriority: translationConfig.matchPriority,
                stableClassPrefixes: translationConfig.stableClassPrefixes,
                unstableIdPattern: translationConfig.unstableIdPattern,
            },
        );

        if (resolved) {
            mappings.set(field.cell.toUpperCase(), resolved);
            continue;
        }

        unresolved.push({
            cell: field.cell,
            label: field.label,
            baselineText,
            reason:
                "비교군 `.business-area` 내부에 global 엑셀 텍스트·aria-label·alt 와 일치하는 DOM 위치가 없습니다.",
        });
    }

    return { mappings, unresolved };
}
