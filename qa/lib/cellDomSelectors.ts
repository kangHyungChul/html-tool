import fs from "node:fs";

import { load, type CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { getTemplateHtmlPath } from "./assets";

/** placeholder 가 들어 있는 요소 — 텍스트 노드 우선(img alt 보다 span 등) */
const TEXT_ELEMENT_TAGS = new Set(["h2", "h3", "h4", "p", "span", "a", "button"]);

const PLACEHOLDER_RE = /\{([A-Z]+[0-9]+)\}/g;

/** 셀 주소 → `.business-area` 기준 CSS 셀렉터(템플릿 placeholder 위치에서 생성) */
let cellSelectorCache: Map<string, string> | null = null;

/**
 * 템플릿 HTML 에서 `{D6}` placeholder 가 있는 요소를 찾아 셀별 셀렉터를 만든다.
 * - 동일 셀이 img alt·버튼 텍스트 등 여러 곳에 있으면 **보이는 텍스트 태그** 우선
 */
function buildCellSelectorMap(): Map<string, string> {
    const templatePath = getTemplateHtmlPath();
    const html = fs.readFileSync(templatePath, "utf-8");
    const $ = load(html);

    const map = new Map<string, string>();
    const root = $(".business-area").first();
    if (!root.length) {
        return map;
    }

    root.find("*").each((_, el) => {
        const $el = $(el);
        const tag = el.tagName?.toLowerCase() ?? "";

        const registerCell = (cell: string, inAttr: boolean, isDirectPlaceholder: boolean) => {
            if (inAttr && !isDirectPlaceholder && map.has(cell)) {
                return;
            }
            if (map.has(cell)) {
                const existingTag = map.get(cell)!.split(/[.#\s>]/)[1] ?? "";
                if (!TEXT_ELEMENT_TAGS.has(tag) && TEXT_ELEMENT_TAGS.has(existingTag)) {
                    return;
                }
            }
            const selector = buildUniqueSelectorWithinBusinessArea($, el);
            if (selector) {
                map.set(cell, selector);
            }
        };

        for (const attr of ["alt", "aria-label"] as const) {
            const attrVal = $el.attr(attr);
            if (!attrVal) {
                continue;
            }
            for (const match of attrVal.matchAll(PLACEHOLDER_RE)) {
                const cell = match[1];
                registerCell(cell, true, false);
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
            const inAttr =
                attrAlt === `{${cell}}` ||
                attrAlt?.includes(`{${cell}}`) ||
                attrAria === `{${cell}}`;

            if (!isDirectPlaceholder && !inAttr) {
                continue;
            }

            registerCell(cell, inAttr, isDirectPlaceholder);
        }
    });

    return map;
}

/** `.business-area` 루트까지 올라가며 nth-of-type 경로 생성 */
function buildUniqueSelectorWithinBusinessArea($: CheerioAPI, el: Element): string | null {
    const segments: string[] = [];
    let node: Element | null = el;

    while (node && node.tagName) {
        const tag = node.tagName.toLowerCase();
        const parent = node.parent;

        if (!parent || parent.type !== "tag") {
            segments.unshift(tag);
            break;
        }

        const parentEl = parent as Element;
        const sameTagSiblings = parentEl.children.filter(
            (c): c is Element => c.type === "tag" && (c as Element).tagName?.toLowerCase() === tag,
        );
        const index = sameTagSiblings.indexOf(node) + 1;
        segments.unshift(`${tag}:nth-of-type(${index})`);

        if (tag === "div" && $(node).hasClass("business-area")) {
            break;
        }

        node = parentEl;
    }

    if (segments.length === 0) {
        return null;
    }

    return `.business-area ${segments.join(" > ")}`;
}

/** 셀 주소에 대응하는 DOM 셀렉터 (lazy cache) */
export function getCellDomSelector(cell: string): string | undefined {
    if (!cellSelectorCache) {
        cellSelectorCache = buildCellSelectorMap();
    }
    return cellSelectorCache.get(cell.toUpperCase());
}
