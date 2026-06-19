import fs from "node:fs";

import { load, type CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import type { CellTextReadFrom } from "./cellTextRead";
import { getTemplateHtmlPath } from "./assets";

/** placeholder 가 들어 있는 요소 — 텍스트 노드 우선(img alt 보다 span 등) */
const TEXT_ELEMENT_TAGS = new Set(["h2", "h3", "h4", "p", "span", "a", "button"]);

const PLACEHOLDER_RE = /\{([A-Z]+[0-9]+)\}/g;

/** as-is·live DOM 과 맞추기 위한 안정 class 접두사 (qaConfig.translation 과 동일) */
const STABLE_CLASS_PREFIXES = ["cmp-", "c-text-", "accordion-", "business-area"];

const UNSTABLE_ID_PATTERN = /swiper|uuid|random/i;

/** 템플릿 `{D6}` placeholder 위치 — QA는 이 구조를 as-is·검증대상 공통 좌표로 사용 */
export interface CellTemplateDomMapping {
    /** `.business-area` 루트 기준 상대 CSS 셀렉터 */
    relativeSelector: string;
    readFrom: CellTextReadFrom;
    /** 템플릿 전체 경로 (디버그·UI용) */
    fullSelector: string;
}

let cellTemplateCache: Map<string, CellTemplateDomMapping> | null = null;

function toRelativeSelector(fullSelector: string): string {
    return fullSelector.replace(/^\.business-area\s+/, "").trim();
}

function cssEscape(value: string): string {
    return value.replace(/([^\w-])/g, "\\$1");
}

/**
 * 템플릿 HTML 에서 `{D6}` placeholder 가 있는 요소를 찾아 셀별 구조 셀렉터를 만든다.
 * - 동일 셀이 img alt·버튼 텍스트 등 여러 곳에 있으면 **보이는 텍스트 태그** 우선
 * - nth-of-type 만 쓰지 않고 id·cmp- class 등 **안정 segment** 우선 (live AEM DOM 호환)
 */
function buildCellTemplateMap(): Map<string, CellTemplateDomMapping> {
    const templatePath = getTemplateHtmlPath();
    const html = fs.readFileSync(templatePath, "utf-8");
    const $ = load(html);

    const map = new Map<string, CellTemplateDomMapping>();
    const root = $(".business-area").first();
    if (!root.length) {
        return map;
    }

    const registerCell = (
        cell: string,
        readFrom: CellTextReadFrom,
        inAttr: boolean,
        isDirectPlaceholder: boolean,
        el: Element,
    ) => {
        const tag = el.tagName?.toLowerCase() ?? "";
        if (inAttr && !isDirectPlaceholder && map.has(cell)) {
            return;
        }
        if (map.has(cell)) {
            const existingTag = map.get(cell)!.fullSelector.split(/[.#\s>]/)[1] ?? "";
            if (!TEXT_ELEMENT_TAGS.has(tag) && TEXT_ELEMENT_TAGS.has(existingTag)) {
                return;
            }
        }
        const fullSelector = buildUniqueSelectorWithinBusinessArea($, el);
        if (!fullSelector) {
            return;
        }
        map.set(cell, {
            fullSelector,
            relativeSelector: toRelativeSelector(fullSelector),
            readFrom,
        });
    };

    root.find("*").each((_, el) => {
        const $el = $(el);
        const tag = el.tagName?.toLowerCase() ?? "";

        for (const attr of ["alt", "aria-label"] as const) {
            const attrVal = $el.attr(attr);
            if (!attrVal) {
                continue;
            }
            const readFrom: CellTextReadFrom = attr === "aria-label" ? "aria-label" : "alt";
            for (const match of attrVal.matchAll(PLACEHOLDER_RE)) {
                registerCell(match[1], readFrom, true, attrVal.trim() === `{${match[1]}}`, el);
            }
        }

        const outer = $el.html() ?? "";
        const ownText = $el.text().trim();

        for (const match of outer.matchAll(PLACEHOLDER_RE)) {
            const cell = match[1];
            const isDirectPlaceholder =
                ownText === `{${cell}}` || outer.trim() === `{${cell}}` || ownText.includes(`{${cell}}`);

            const attrAlt = $el.attr("alt");
            const attrAria = $el.attr("aria-label");
            const inAttr = Boolean(
                attrAlt === `{${cell}}` ||
                    attrAlt?.includes(`{${cell}}`) ||
                    attrAria === `{${cell}}` ||
                    attrAria?.includes(`{${cell}}`),
            );

            if (!isDirectPlaceholder && !inAttr) {
                continue;
            }

            let readFrom: CellTextReadFrom = "text";
            if (attrAria === `{${cell}}` || attrAria?.includes(`{${cell}}`)) {
                readFrom = "aria-label";
            } else if (attrAlt === `{${cell}}` || attrAlt?.includes(`{${cell}}`)) {
                readFrom = "alt";
            } else if (tag === "img") {
                readFrom = "alt";
            }

            registerCell(cell, readFrom, inAttr, isDirectPlaceholder, el);
        }
    });

    return map;
}

/** 한 단계 DOM segment — live 페이지 baseline 매핑과 동일 규칙 */
function buildSegment($: CheerioAPI, el: Element): string {
    const tag = el.tagName.toLowerCase();
    const $el = $(el);

    const id = $el.attr("id");
    if (id && /^[a-zA-Z][\w-]*$/.test(id) && !UNSTABLE_ID_PATTERN.test(id)) {
        return `#${cssEscape(id)}`;
    }

    const classes = ($el.attr("class") ?? "").split(/\s+/).filter(Boolean);
    const stableClasses = classes.filter(
        (c) => STABLE_CLASS_PREFIXES.some((p) => c.startsWith(p)) && !c.includes("swiper"),
    );

    if (stableClasses.length > 0) {
        const classPart = stableClasses
            .slice(0, 2)
            .map((c) => `.${cssEscape(c)}`)
            .join("");
        const parent = el.parent;
        if (parent && parent.type === "tag") {
            const parentEl = parent as Element;
            const siblings = parentEl.children.filter(
                (c): c is Element =>
                    c.type === "tag" &&
                    (c as Element).tagName?.toLowerCase() === tag &&
                    stableClasses.every((cl) => $(c).hasClass(cl)),
            );
            if (siblings.length === 1) {
                return `${tag}${classPart}`;
            }
            const nthChild = parentEl.children.indexOf(el) + 1;
            return `${tag}${classPart}:nth-child(${nthChild})`;
        }
        return `${tag}${classPart}`;
    }

    const parent = el.parent;
    if (!parent || parent.type !== "tag") {
        return tag;
    }
    const parentEl = parent as Element;
    const sameTag = parentEl.children.filter(
        (c): c is Element => c.type === "tag" && (c as Element).tagName?.toLowerCase() === tag,
    );
    const idx = sameTag.indexOf(el) + 1;
    return `${tag}:nth-of-type(${idx})`;
}

/** `.business-area` 루트까지 올라가며 안정 class·id 우선 경로 생성 */
function buildUniqueSelectorWithinBusinessArea($: CheerioAPI, el: Element): string | null {
    const segments: string[] = [];
    let node: Element | null = el;

    while (node && node.tagName) {
        const tag = node.tagName.toLowerCase();

        if (tag === "div" && $(node).hasClass("business-area")) {
            break;
        }

        segments.unshift(buildSegment($, node));
        const parent = node.parent;
        if (!parent || parent.type !== "tag") {
            break;
        }
        node = parent as Element;
    }

    if (segments.length === 0) {
        return null;
    }

    return `.business-area ${segments.join(" > ")}`;
}

function getCellTemplateMap(): Map<string, CellTemplateDomMapping> {
    if (!cellTemplateCache) {
        cellTemplateCache = buildCellTemplateMap();
    }
    return cellTemplateCache;
}

/** 셀 주소에 대응하는 템플릿 구조 매핑 */
export function getCellTemplateDomMapping(cell: string): CellTemplateDomMapping | undefined {
    return getCellTemplateMap().get(cell.toUpperCase());
}

/** @deprecated `getCellTemplateDomMapping` 사용 */
export function getCellDomSelector(cell: string): string | undefined {
    return getCellTemplateDomMapping(cell)?.fullSelector;
}
