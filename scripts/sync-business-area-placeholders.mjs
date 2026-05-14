/**
 * `business-area.cell-placeholder.mapped.html` 과 동일한 `{D4}` 형 플레이스홀더를
 * `business-area.cell-placeholder.mapped_0514.html` 에 반영한다.
 *
 * - 참조 HTML 은 node-html-parser 로 DFS 순회하며 플레이스홀더를 **문서 순서**로 수집한다.
 * - 대상 HTML 은 전체를 다시 직렬화하지 않고, `indexOf` / 앵커 정규식으로 구간만 교체해
 *   들여쓰기·속성 순서를 유지한다.
 *
 * 실행: `npm run sync:business-area-placeholders`
 * 또는: `node scripts/sync-business-area-placeholders.mjs`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, NodeType } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const mappedPath = path.join(
  rootDir,
  "public/templates/business-area.cell-placeholder.mapped.html",
);
const targetPath = path.join(
  rootDir,
  "public/templates/business-area.cell-placeholder.mapped_0514.html",
);

/** 엑셀 셀 placeholder 한 덩어리인지 (대문자 열 + 행) */
const PH = /^\{[A-Z]+[0-9]+\}$/;

/**
 * role="tabpanel" 인 가장 가까운 상위 div 의 id (스티키 탭 `<a>` 는 null).
 * @param {import("node-html-parser").HTMLElement} el
 */
function nearestTabpanelId(el) {
  let cur = el;
  while (cur) {
    if (
      String(cur.tagName || "").toLowerCase() === "div" &&
      cur.getAttribute("role") === "tabpanel" &&
      cur.getAttribute("id")
    ) {
      return cur.getAttribute("id");
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * class 에 accordion-content 가 들어간 div 의 id.
 * @param {import("node-html-parser").HTMLElement} el
 */
function nearestAccordionPanelId(el) {
  let cur = el;
  while (cur) {
    const cls = cur.getAttribute?.("class") || "";
    if (
      String(cur.tagName || "").toLowerCase() === "div" &&
      cls.includes("accordion-content") &&
      cur.getAttribute("id")
    ) {
      return cur.getAttribute("id");
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * @param {import("node-html-parser").HTMLElement} el
 */
function isDisclaimerContext(el) {
  let cur = el;
  while (cur) {
    const cls = cur.getAttribute?.("class") || "";
    if (cls.includes("c-text-contents__disclaimer")) return true;
    cur = cur.parentNode;
  }
  return false;
}

/**
 * @param {import("node-html-parser").HTMLElement} el
 * @param {string} cls
 */
function isUnderClass(el, cls) {
  let cur = el;
  while (cur) {
    const c = cur.getAttribute?.("class") || "";
    if (c.includes(cls)) return true;
    cur = cur.parentNode;
  }
  return false;
}

/**
 * class 토큰 정확 일치 (cmp-title__text 등).
 * @param {import("node-html-parser").HTMLElement} el
 * @param {string} cls
 */
function classHas(el, cls) {
  const c = el.getAttribute("class") || "";
  return c.split(/\s+/).includes(cls);
}

/**
 * mapped 의 `.business-area` 루트만 DFS 하여 치환 op 목록을 만든다.
 * @param {import("node-html-parser").HTMLElement} root
 */
function collectOps(root) {
  /** @type {object[]} */
  const ops = [];

  /**
   * @param {import("node-html-parser").Node} node
   */
  function visit(node) {
    if (!node) return;

    if (node.nodeType === NodeType.ELEMENT_NODE) {
      const el = /** @type {import("node-html-parser").HTMLElement} */ (node);
      const tag = String(el.tagName || "").toLowerCase();

      if (tag === "img") {
        const alt = (el.getAttribute("alt") || "").trim();
        if (PH.test(alt)) {
          const src = el.getAttribute("src") || "";
          const moFile = src.split("/").pop();
          if (!moFile) {
            throw new Error(`img alt=${alt} 인데 src 에서 파일명 추출 실패`);
          }
          ops.push({ kind: "img_alt", moFile, ph: alt });
        }
      }

      for (const ch of el.childNodes) visit(ch);
      return;
    }

    if (node.nodeType === NodeType.TEXT_NODE) {
      const t = node.rawText.trim();
      if (!PH.test(t)) return;

      const parent = node.parentNode;
      if (!parent || parent.nodeType !== NodeType.ELEMENT_NODE) return;
      const pel = /** @type {import("node-html-parser").HTMLElement} */ (parent);
      const ptag = String(pel.tagName || "").toLowerCase();
      const panelId = nearestTabpanelId(pel);

      if (ptag === "a") {
        const aid = pel.getAttribute("id") || "";
        if (aid.startsWith("tab-")) {
          ops.push({ kind: "tab_label", tabId: aid, ph: t });
          return;
        }
      }

      // ST0013 본문 `<p>` 와 동일 클래스를 쓰는 아코디언 상단 본문 — ST 보다 먼저 분기해야 한다.
      if (ptag === "p" && isUnderClass(pel, "accordion-top")) {
        const apid = nearestAccordionPanelId(pel);
        if (!apid) {
          throw new Error(`accordion 본문 p 인데 panel id 없음: ${t}`);
        }
        ops.push({ kind: "accordion_body_p", accordionPanelId: apid, ph: t });
        return;
      }

      if (panelId === "eco-solution") {
        if (ptag === "p" && isUnderClass(pel, "c-text-contents__eyebrow")) {
          ops.push({ kind: "st_eyebrow_p", tabpanelId: "eco-solution", ph: t });
          return;
        }
        if (ptag === "h2" && classHas(pel, "cmp-title__text")) {
          ops.push({ kind: "st_h2", tabpanelId: "eco-solution", ph: t });
          return;
        }
        if (ptag === "p" && isUnderClass(pel, "c-text-contents__bodycopy")) {
          ops.push({ kind: "st_body_p", tabpanelId: "eco-solution", ph: t });
          return;
        }
      }
      if (panelId === "vehicle-solution") {
        if (ptag === "p" && isUnderClass(pel, "c-text-contents__eyebrow")) {
          ops.push({
            kind: "st_eyebrow_p",
            tabpanelId: "vehicle-solution",
            ph: t,
          });
          return;
        }
        if (ptag === "h2" && classHas(pel, "cmp-title__text")) {
          ops.push({ kind: "st_h2", tabpanelId: "vehicle-solution", ph: t });
          return;
        }
        if (ptag === "p" && isUnderClass(pel, "c-text-contents__bodycopy")) {
          ops.push({ kind: "st_body_p", tabpanelId: "vehicle-solution", ph: t });
          return;
        }
        if (ptag === "p" && isDisclaimerContext(pel)) {
          ops.push({
            kind: "st_disclaimer_p",
            tabpanelId: "vehicle-solution",
            ph: t,
          });
          return;
        }
      }
      if (panelId === "media-entertainment-solution") {
        if (ptag === "p" && isUnderClass(pel, "c-text-contents__eyebrow")) {
          ops.push({
            kind: "st_eyebrow_p",
            tabpanelId: "media-entertainment-solution",
            ph: t,
          });
          return;
        }
        if (ptag === "h2" && classHas(pel, "cmp-title__text")) {
          ops.push({
            kind: "st_h2",
            tabpanelId: "media-entertainment-solution",
            ph: t,
          });
          return;
        }
        if (ptag === "p" && isUnderClass(pel, "c-text-contents__bodycopy")) {
          ops.push({
            kind: "st_body_p",
            tabpanelId: "media-entertainment-solution",
            ph: t,
          });
          return;
        }
      }
      if (panelId === "home-appliance-solution") {
        if (ptag === "p" && isUnderClass(pel, "c-text-contents__eyebrow")) {
          ops.push({
            kind: "st_eyebrow_p",
            tabpanelId: "home-appliance-solution",
            ph: t,
          });
          return;
        }
        if (ptag === "h2" && classHas(pel, "cmp-title__text")) {
          ops.push({
            kind: "st_h2",
            tabpanelId: "home-appliance-solution",
            ph: t,
          });
          return;
        }
        if (ptag === "p" && isUnderClass(pel, "c-text-contents__bodycopy")) {
          ops.push({
            kind: "st_body_p",
            tabpanelId: "home-appliance-solution",
            ph: t,
          });
          return;
        }
      }

      if (ptag === "h3" && classHas(pel, "accordion-button-text")) {
        const btn = pel.parentNode;
        if (
          btn &&
          btn.nodeType === NodeType.ELEMENT_NODE &&
          String(btn.tagName || "").toLowerCase() === "button"
        ) {
          const bid = /** @type {import("node-html-parser").HTMLElement} */ (
            btn
          ).getAttribute("id");
          if (!bid) throw new Error("accordion button id 없음");
          ops.push({ kind: "accordion_h3", btnId: bid, ph: t });
          return;
        }
      }

      if (ptag === "h4" && classHas(pel, "cmp-title__text")) {
        const apid = nearestAccordionPanelId(pel);
        if (!apid) {
          throw new Error(`h4 플레이스홀더인데 accordion panel id 없음: ${t}`);
        }
        ops.push({ kind: "accordion_h4", accordionPanelId: apid, ph: t });
        return;
      }

      if (ptag === "span" && classHas(pel, "c-button__text")) {
        const a = pel.parentNode;
        if (
          a &&
          a.nodeType === NodeType.ELEMENT_NODE &&
          String(a.tagName || "").toLowerCase() === "a"
        ) {
          const href = /** @type {import("node-html-parser").HTMLElement} */ (
            a
          ).getAttribute("href");
          if (!href) throw new Error("CTA span 부모 a 에 href 없음");
          ops.push({ kind: "cta_span", href, ph: t });
          return;
        }
      }

      throw new Error(`분류되지 않은 플레이스홀더 텍스트: ${t}`);
    }
  }

  visit(root);
  return ops;
}

/**
 * @param {string} s
 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * g 플래그 없는 RegExp.exec 는 lastIndex 를 무시하므로, tail 에서만 매칭한다.
 * @param {string} html
 * @param {RegExp} re
 * @param {string} ph
 * @param {number} from 항상 0 을 넘겨 전체 문서에서 id 앵커로 유일 매칭한다.
 */
function replaceFirstReFrom(html, re, ph, from) {
  const tailStr = html.slice(from);
  const m = re.exec(tailStr);
  if (!m) {
    throw new Error(`정규식 매칭 실패: ${re} from=${from}`);
  }
  const globalIndex = from + m.index;
  const full = m[0];
  const head = m[1];
  const mid = m[2];
  const tail = m[3];
  if (mid === ph) {
    return { html, nextFrom: globalIndex + full.length };
  }
  const rebuilt = head + ph + tail;
  const out =
    html.slice(0, globalIndex) + rebuilt + html.slice(globalIndex + full.length);
  return { html: out, nextFrom: globalIndex + rebuilt.length };
}

/**
 * mo.jpg 파일명 위치 이후 첫 `alt="..."` 값만 치환.
 */
function replaceImgAltAfter(html, moFile, ph, from) {
  const i = html.indexOf(moFile, from);
  if (i === -1) {
    throw new Error(`대상 HTML 에서 mo 파일명을 찾을 수 없음: ${moFile}`);
  }
  const a = html.indexOf('alt="', i);
  if (a === -1) throw new Error(`alt=" 를 찾을 수 없음 (mo 이후): ${moFile}`);
  const q0 = a + 5;
  const q1 = html.indexOf('"', q0);
  if (q1 === -1) throw new Error("alt 값 종료 따옴표 없음");
  return { html: html.slice(0, q0) + ph + html.slice(q1), nextFrom: q0 + ph.length };
}

function replaceCtaSpanAfter(html, href, ph, from) {
  const h = html.indexOf(href, from);
  if (h === -1) throw new Error(`href 를 찾을 수 없음: ${href}`);
  const t = html.indexOf("c-button__text", h);
  if (t === -1) {
    throw new Error(`c-button__text 를 찾을 수 없음 (href 이후): ${href}`);
  }
  const gt = html.indexOf(">", t);
  if (gt === -1) throw new Error("c-button__text 태그 종료 > 없음");
  const start = gt + 1;
  const end = html.indexOf("</span>", start);
  if (end === -1) throw new Error("</span> 없음 (CTA)");
  return { html: html.slice(0, start) + ph + html.slice(end), nextFrom: start + ph.length };
}

function replaceTabLabel(html, tabId, ph, from) {
  const needle = `id="${tabId}"`;
  const i = html.indexOf(needle, from);
  if (i === -1) throw new Error(`탭 id 를 찾을 수 없음: ${tabId}`);
  const gt = html.indexOf(">", i);
  if (gt === -1) throw new Error("탭 a 태그 > 없음");
  const start = gt + 1;
  const end = html.indexOf("</a>", start);
  if (end === -1) throw new Error("</a> 없음 (탭)");
  return { html: html.slice(0, start) + ph + html.slice(end), nextFrom: start + ph.length };
}

function replaceStEyebrow(html, tabpanelId, ph) {
  // (?<![-\w]) : `data-hq-panel-id="vehicle-solution"` 안의 `id="vehicle-solution"` 오매칭 방지
  const re = new RegExp(
    `((?<![-\\w])id="${escapeRe(tabpanelId)}"[\\s\\S]*?c-text-contents__eyebrow[\\s\\S]*?<p>)([\\s\\S]*?)(<\\/p>)`,
  );
  return replaceFirstReFrom(html, re, ph, 0);
}

function replaceStH2(html, tabpanelId, ph) {
  const re = new RegExp(
    `((?<![-\\w])id="${escapeRe(tabpanelId)}"[\\s\\S]*?c-text-contents__headline[\\s\\S]*?<h2 class="cmp-title__text">)([\\s\\S]*?)(<\\/h2>)`,
  );
  return replaceFirstReFrom(html, re, ph, 0);
}

function replaceStBody(html, tabpanelId, ph) {
  const re = new RegExp(
    `((?<![-\\w])id="${escapeRe(tabpanelId)}"[\\s\\S]*?c-text-contents__bodycopy[\\s\\S]*?<p>)([\\s\\S]*?)(<\\/p>)`,
  );
  return replaceFirstReFrom(html, re, ph, 0);
}

function replaceStDisclaimer(html, tabpanelId, ph) {
  const re = new RegExp(
    `((?<![-\\w])id="${escapeRe(tabpanelId)}"[\\s\\S]*?c-text-contents__disclaimer[\\s\\S]*?<p>)([\\s\\S]*?)(<\\/p>)`,
  );
  return replaceFirstReFrom(html, re, ph, 0);
}

function replaceAccordionH3(html, btnId, ph) {
  const re = new RegExp(
    `(id="${escapeRe(btnId)}"[\\s\\S]*?<h3 class="accordion-button-text">)([\\s\\S]*?)(<\\/h3>)`,
  );
  return replaceFirstReFrom(html, re, ph, 0);
}

function replaceAccordionH4(html, apid, ph) {
  const re = new RegExp(
    `(id="${escapeRe(apid)}"[\\s\\S]*?<h4 class="cmp-title__text">)([\\s\\S]*?)(<\\/h4>)`,
  );
  return replaceFirstReFrom(html, re, ph, 0);
}

function replaceAccordionBodyP(html, apid, ph) {
  const re = new RegExp(
    `(id="${escapeRe(apid)}"[\\s\\S]*?accordion-top[\\s\\S]*?c-text-contents__bodycopy[\\s\\S]*?<p>)([\\s\\S]*?)(<\\/p>)`,
  );
  return replaceFirstReFrom(html, re, ph, 0);
}

function main() {
  const mappedRaw = fs.readFileSync(mappedPath, "utf8");
  let target = fs.readFileSync(targetPath, "utf8");

  const mappedRoot = parse(mappedRaw, {
    comment: true,
    blockTextElements: {
      script: true,
      style: true,
      pre: true,
    },
  });

  const ba = mappedRoot.querySelector(".business-area");
  if (!ba) throw new Error("mapped 에 .business-area 없음");

  const ops = collectOps(ba);
  const mappedPhCount = (mappedRaw.match(/\{[A-Z]+[0-9]+\}/g) || []).length;
  if (ops.length !== mappedPhCount) {
    throw new Error(
      `수집된 op 수(${ops.length})와 mapped 의 플레이스홀더 수(${mappedPhCount}) 불일치`,
    );
  }

  const seqKinds = new Set(["tab_label", "img_alt", "cta_span"]);
  /** 정규식(id 앵커) 치환이 먼저 일어나야 seqFrom(indexOf) 위치가 깨지지 않는다. */
  const regexOps = ops.filter((o) => !seqKinds.has(o.kind));
  const seqOps = ops.filter((o) => seqKinds.has(o.kind));

  for (const op of regexOps) {
    let r;
    switch (op.kind) {
      case "st_eyebrow_p":
        r = replaceStEyebrow(target, op.tabpanelId, op.ph);
        break;
      case "st_h2":
        r = replaceStH2(target, op.tabpanelId, op.ph);
        break;
      case "st_body_p":
        r = replaceStBody(target, op.tabpanelId, op.ph);
        break;
      case "st_disclaimer_p":
        r = replaceStDisclaimer(target, op.tabpanelId, op.ph);
        break;
      case "accordion_h3":
        r = replaceAccordionH3(target, op.btnId, op.ph);
        break;
      case "accordion_h4":
        r = replaceAccordionH4(target, op.accordionPanelId, op.ph);
        break;
      case "accordion_body_p":
        r = replaceAccordionBodyP(target, op.accordionPanelId, op.ph);
        break;
      default:
        throw new Error(`regex 패스: 알 수 없는 op ${JSON.stringify(op)}`);
    }
    target = r.html;
  }

  let seqFrom = 0;
  for (const op of seqOps) {
    let r;
    switch (op.kind) {
      case "img_alt":
        r = replaceImgAltAfter(target, op.moFile, op.ph, seqFrom);
        seqFrom = r.nextFrom;
        break;
      case "cta_span":
        r = replaceCtaSpanAfter(target, op.href, op.ph, seqFrom);
        seqFrom = r.nextFrom;
        break;
      case "tab_label":
        r = replaceTabLabel(target, op.tabId, op.ph, seqFrom);
        seqFrom = r.nextFrom;
        break;
      default:
        throw new Error(`seq 패스: 알 수 없는 op ${JSON.stringify(op)}`);
    }
    target = r.html;
  }

  const outCount = (target.match(/\{[A-Z]+[0-9]+\}/g) || []).length;
  if (outCount !== mappedPhCount) {
    throw new Error(
      `결과 플레이스홀더 수(${outCount}) 기대(${mappedPhCount}) 불일치`,
    );
  }

  fs.writeFileSync(targetPath, target, "utf8");
  console.log(`OK: ${ops.length} placeholders → ${path.relative(rootDir, targetPath)}`);
}

main();
