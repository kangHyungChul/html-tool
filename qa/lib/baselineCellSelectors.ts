import type { Locator } from "playwright";

import type { CellTextReadFrom } from "./cellTextRead";
import { getCellTemplateDomMapping } from "./cellDomSelectors";
import { getIgnoreValues, listTextFieldsForQa } from "./loadExcelByLocale";
import { getQaConfig, type QaConfig } from "./qaConfig";
import { normalizeForCompare, shouldIgnoreValue } from "./normalizeText";
import { readTextAtRelativeSelector } from "./readActualCellText";
import { throwIfAborted } from "./businessAreaScope";

/** 셀 한 개의 DOM 위치 매핑 결과 */
export interface CellDomMapping {
    /** `.business-area` 루트 기준 상대 CSS 셀렉터 */
    relativeSelector: string;
    /** 템플릿 구조로 확정했거나, as-is DOM 텍스트·class 경로로 확정 */
    source: "template-structure" | "baseline-dom";
    /** locale 검증 시 읽을 속성 */
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
 * as-is(global) `.business-area` 에서 셀 위치를 확정한다.
 *
 * 1) 템플릿 `{D6}` 구조 셀렉터가 as-is 에서 **유일**하고 global 엑셀과 일치 → 구조 매핑
 * 2) 그 외 as-is DOM 에서 global 텍스트·aria-label·alt 로 요소를 찾고,
 *    id·cmp- class 등 **안정 셀렉터**로 상대 경로를 생성 (템플릿 readFrom·구조로 중복 후보 구분)
 *
 * 검증 대상은 여기서 확정한 `relativeSelector` + `readFrom` 만 사용한다.
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
        const templateMapping = getCellTemplateDomMapping(field.cell);

        /** 1) 템플릿 구조 셀렉터가 as-is 에서 유일하고 global 엑셀과 일치하면 그대로 사용 */
        if (templateMapping) {
            const templateCount = await scope.locator(templateMapping.relativeSelector).count();
            if (templateCount === 1) {
                const actualAtTemplate = await readTextAtRelativeSelector(
                    scope,
                    templateMapping.relativeSelector,
                    templateMapping.readFrom,
                );
                if (normalizeForCompare(actualAtTemplate) === normalizedBaseline) {
                    mappings.set(field.cell.toUpperCase(), {
                        relativeSelector: templateMapping.relativeSelector,
                        source: "template-structure",
                        readFrom: templateMapping.readFrom,
                    });
                    continue;
                }
            }
        }

        /** 2) as-is DOM 텍스트 탐색 + 안정 class 경로 (템플릿 힌트로 중복 텍스트 구분) */
        const resolved = await scope.evaluate(
            (
                root,
                {
                    normalizedBaseline,
                    panelId,
                    matchPriority,
                    stableClassPrefixes,
                    unstableIdPattern,
                    stableAnchorIdPatterns,
                    templateRelativeSelector,
                    templateReadFrom,
                }: {
                    normalizedBaseline: string;
                    panelId: string | null;
                    matchPriority: CellTextReadFrom[];
                    stableClassPrefixes: string[];
                    unstableIdPattern: string;
                    stableAnchorIdPatterns: string[];
                    templateRelativeSelector: string | null;
                    templateReadFrom: CellTextReadFrom | null;
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

                const unstableRe = new RegExp(unstableIdPattern, "i");

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

                /** business-area-ha-ac-panel-3 등 안정 id — `qaConfig.translation.stableAnchorIdPatterns` */
                function isAnchorId(id: string): boolean {
                    for (const pattern of stableAnchorIdPatterns) {
                        if (new RegExp(pattern, "i").test(id)) {
                            return !unstableRe.test(id);
                        }
                    }
                    return false;
                }

                /** 템플릿 구조 힌트 — 동일 텍스트가 여러 개일 때 올바른 위치 우선 */
                function templateDisambiguationScore(el: Element): number {
                    let score = 0;
                    if (templateRelativeSelector) {
                        try {
                            const templateNodes = [...root.querySelectorAll(templateRelativeSelector)];
                            if (templateNodes.length === 1) {
                                const anchor = templateNodes[0];
                                if (anchor === el) {
                                    score += 100;
                                } else if (anchor.contains(el) || el.contains(anchor)) {
                                    score += 50;
                                }
                            }
                        } catch {
                            /* 잘못된 셀렉터는 무시 */
                        }
                    }
                    return score;
                }

                /** id·안정 class 우선, 없으면 형제 tag 순번으로 한 단계 셀렉터 생성 */
                function buildSegment(el: Element): string {
                    const tag = el.tagName.toLowerCase();

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

                /** `.business-area` 루트까지 상대 경로 — 안정 id 앵커 우선 */
                function buildRelative(el: Element, rootEl: Element): string {
                    let anchor: Element | null = null;
                    let walk: Element | null = el;
                    while (walk && walk !== rootEl) {
                        const walkId = walk.getAttribute("id");
                        if (walkId && isAnchorId(walkId)) {
                            anchor = walk;
                            break;
                        }
                        walk = walk.parentElement;
                    }

                    const tailSegments: string[] = [];
                    let node: Element | null = el;
                    const stopAt = anchor ?? rootEl;
                    while (node && node !== stopAt && node.tagName) {
                        tailSegments.unshift(buildSegment(node));
                        node = node.parentElement;
                    }

                    if (anchor) {
                        const anchorId = anchor.getAttribute("id")!;
                        return `#${cssEscape(anchorId)} > ${tailSegments.join(" > ")}`;
                    }

                    return tailSegments.join(" > ");
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
                        const templateDiff =
                            templateDisambiguationScore(b) - templateDisambiguationScore(a);
                        if (templateDiff !== 0) {
                            return templateDiff;
                        }
                        /** 템플릿 readFrom 과 일치하는 읽기 경로 우선 */
                        if (templateReadFrom && group.kind === templateReadFrom) {
                            return -1;
                        }
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

                        /** 템플릿이 readFrom 을 알려주면 검증 대상에서도 동일 경로로 읽기 */
                        const readFrom: CellTextReadFrom =
                            templateReadFrom ?? group.kind;

                        return {
                            relativeSelector,
                            source: "baseline-dom" as const,
                            readFrom,
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
                stableAnchorIdPatterns: translationConfig.stableAnchorIdPatterns,
                templateRelativeSelector: templateMapping?.relativeSelector ?? null,
                templateReadFrom: templateMapping?.readFrom ?? null,
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
                "as-is `.business-area` 에서 global 엑셀과 일치하는 DOM 위치를 확정하지 못했습니다. (템플릿 구조·텍스트 매칭 모두 실패)",
        });
    }

    return { mappings, unresolved };
}
