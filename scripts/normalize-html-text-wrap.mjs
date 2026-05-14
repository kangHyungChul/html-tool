#!/usr/bin/env node
/**
 * HTML 소스 안에서 포맷터가 넣은 "줄바꿈 + 들여쓰기 공백" 을,
 * **태그 직렬화 없이** 문자열만 안전하게 접는다 (boolean 속성 유지).
 *
 * 기본 동작:
 * - 파일 전체 줄끝: CRLF / CR → LF
 * - `marker` 문자열이 **첫 번째로** 나오면, 그 **끝까지(포함)** 는 그대로 두고
 *   그 **이후** 문자열만 규칙(pairs)을 적용한다. (`<style>` 보존용; marker 없으면 전체 적용)
 *
 * 사용 예:
 *   node scripts/normalize-html-text-wrap.mjs
 *     → 인자 없음: 터미널에서 폴더를 옮겨 다니며 .html 파일을 번호로 선택 (TTY 전용)
 *   node scripts/normalize-html-text-wrap.mjs --start ./public
 *     → 대화형 시작 폴더 지정 (상대 경로는 프로젝트 루트 기준)
 *   node scripts/normalize-html-text-wrap.mjs -i ./a.html
 *   node scripts/normalize-html-text-wrap.mjs -i ./a.html -o ./a.out.html
 *   node scripts/normalize-html-text-wrap.mjs ./a.html ./b.html
 *   node scripts/normalize-html-text-wrap.mjs -i ./frag.html --marker ""
 *   node scripts/normalize-html-text-wrap.mjs -i ./x.html --rules ./my-rules.json
 *
 * `--rules` JSON 형식:
 *   {
 *     "marker": "</style>",
 *     "pairs": [
 *       { "open": "<p>", "close": "</p>" },
 *       { "open": "<h2 class=\\"t\\">", "close": "</h2>" }
 *     ]
 *   }
 *   `pairs` 생략 시 아래 DEFAULT_PAIRS 사용.
 */

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * 상대 경로는 프로젝트 루트 기준, 절대 경로는 그대로 사용한다.
 *
 * @param {string} p
 */
function toAbs(p) {
  if (!p) return "";
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(ROOT, p);
}

/** LG business-area 템플릿에서 쓰던 기본 페어 (다른 프로젝트는 --rules 로 덮어쓰기) */
const DEFAULT_PAIRS = [
  { open: "<p>", close: "</p>" },
  { open: '<h2 class="cmp-title__text">', close: "</h2>" },
  { open: '<h3 class="accordion-button-text">', close: "</h3>" },
  { open: '<h4 class="cmp-title__text">', close: "</h4>" },
  {
    open: '<span class="cmp-button__text c-media__button-text sr-only">',
    close: "</span>",
  },
  { open: 'data-cmp-hook-carousel="item">', close: "</a>" },
];

const DEFAULT_MARKER = "</style>";

/**
 * @typedef {{ open: string, close: string }} OpenClosePair
 */

/**
 * @param {string} inner
 */
function flattenSoftWraps(inner) {
  return inner
    .replace(/\r?\n[\t ]+/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * openLiteral … closeLiteral 사이가 **순수 텍스트**(내부에 `<` 없음)일 때만 줄바꿈 접기.
 *
 * @param {string} html
 * @param {string} openLiteral
 * @param {string} closeLiteral
 */
function flattenBetweenLiterals(html, openLiteral, closeLiteral) {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const j = html.indexOf(openLiteral, i);
    if (j === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, j);
    const startInner = j + openLiteral.length;
    const k = html.indexOf(closeLiteral, startInner);
    if (k === -1) {
      out += html.slice(j);
      break;
    }
    let inner = html.slice(startInner, k);
    if (!inner.includes("<")) {
      inner = flattenSoftWraps(inner);
    }
    out += openLiteral + inner + closeLiteral;
    i = k + closeLiteral.length;
  }
  return out;
}

/**
 * argv 파싱: `-i` / `-o` / `--marker` / `--rules` / `--start` / `--help` 및 위치 인자 [input] [output]
 *
 * 입력 경로가 없으면 `mode: "interactive"` (대화형으로 HTML 선택).
 *
 * @returns
 *   | { mode: "batch"; input: string; output: string; cliMarker: string | null | undefined; rulesPath: string }
 *   | { mode: "interactive"; startDir: string; cliMarker: string | null | undefined; rulesPath: string }
 */
function parseCli(argv) {
  let input = "";
  let output = "";
  /** `undefined` = 옵션 미지정(rules 파일 또는 기본값 사용), `null` = 전체 파일에 적용, `string` = 해당 marker */
  let cliMarker = /** @type {string | null | undefined} */ (undefined);
  let rulesPath = "";
  /** 대화형 탐색 시작 폴더 (비어 있으면 process.cwd()) */
  let startDirArg = "";

  for (let a = 0; a < argv.length; a += 1) {
    const x = argv[a];
    if (x === "--help" || x === "-h") {
      printHelp();
      process.exit(0);
    }
    if (x === "-i" || x === "--input") {
      input = argv[++a] ?? "";
      continue;
    }
    if (x === "-o" || x === "--output") {
      output = argv[++a] ?? "";
      continue;
    }
    if (x === "--marker" || x === "--after") {
      const v = argv[++a];
      if (v === undefined) cliMarker = DEFAULT_MARKER;
      else if (v === "") cliMarker = null;
      else cliMarker = v;
      continue;
    }
    if (x === "--rules") {
      rulesPath = argv[++a] ?? "";
      continue;
    }
    if (x === "--start" || x === "-C") {
      startDirArg = argv[++a] ?? "";
      continue;
    }
    if (x.startsWith("-")) {
      console.error(`알 수 없는 옵션: ${x}\n`);
      printHelp();
      process.exit(1);
    }
    if (!input) input = x;
    else if (!output) output = x;
    else {
      console.error("인자가 너무 많습니다.\n");
      printHelp();
      process.exit(1);
    }
  }

  if (!input) {
    const startDir = startDirArg
      ? toAbs(startDirArg)
      : path.resolve(process.cwd());
    return {
      mode: "interactive",
      startDir,
      cliMarker,
      rulesPath: rulesPath ? toAbs(rulesPath) : "",
    };
  }

  if (!output) output = input;

  return {
    mode: "batch",
    input: toAbs(input),
    output: toAbs(output),
    cliMarker,
    rulesPath: rulesPath ? toAbs(rulesPath) : "",
  };
}

function printHelp() {
  console.log(`
normalize-html-text-wrap.mjs — HTML 텍스트 구간의 포맷용 줄바꿈만 정리 (파서 재직렬화 없음)

사용법:
  node scripts/normalize-html-text-wrap.mjs
    인자 없음 → 터미널(TTY)에서 폴더 이동 후 .html 선택, 출력 경로 질문 (Enter = 덮어쓰기)
  node scripts/normalize-html-text-wrap.mjs -i <입력.html> [-o <출력.html>]
  node scripts/normalize-html-text-wrap.mjs <입력.html> [<출력.html>]

옵션:
  -i, --input    입력 HTML 경로 (상대 경로는 프로젝트 루트 기준, 절대 경로 가능)
  -o, --output   출력 경로 (생략 시 입력 파일 덮어쓰기)
  --start, -C    대화형 모드일 때 탐색 시작 폴더 (기본: 현재 작업 디렉터리 cwd)
  --marker, --after   이 문자열 **첫 등장 이후**만 pairs 적용 (기본: ${DEFAULT_MARKER})
                        빈 문자열 지정 시 전체 파일에 적용:  --marker ""
  --rules        pairs / marker 를 담은 JSON (--marker 를 **함께** 주면 CLI 가 marker 우선)
  -h, --help     도움말
`);
}

/**
 * @param {string} rulesPath
 * @returns {Promise<{ marker: string | null, pairs: OpenClosePair[] }>}
 */
async function loadRulesFromFile(rulesPath) {
  const raw = await fs.readFile(rulesPath, "utf8");
  const j = JSON.parse(raw);
  const pairs = Array.isArray(j.pairs)
    ? j.pairs.map((p) => {
        if (p && typeof p.open === "string" && typeof p.close === "string") {
          return { open: p.open, close: p.close };
        }
        throw new Error(`rules.pairs 항목 형식 오류: ${JSON.stringify(p)}`);
      })
    : DEFAULT_PAIRS;
  let marker = DEFAULT_MARKER;
  if (Object.prototype.hasOwnProperty.call(j, "marker")) {
    if (j.marker === null || j.marker === false) marker = null;
    else if (j.marker === "") marker = null;
    else marker = String(j.marker);
  }
  return { marker, pairs };
}

/**
 * @param {string} html
 * @param {string | null} marker
 * @param {OpenClosePair[]} pairs
 */
function applyTransforms(html, marker, pairs) {
  let normalized = html.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let head = "";
  let body = normalized;

  if (marker !== null && marker !== "") {
    const styleIdx = normalized.indexOf(marker);
    if (styleIdx !== -1) {
      head = normalized.slice(0, styleIdx + marker.length);
      body = normalized.slice(styleIdx + marker.length);
    }
    // marker 가 파일에 없으면: head 비우고 전체를 body 로 처리 (에러 내지 않음)
  }

  for (const { open, close } of pairs) {
    body = flattenBetweenLiterals(body, open, close);
  }

  return head + body;
}

/**
 * 터미널에서 디렉터리를 이동하며 .html 파일을 고른다.
 * - `..` 로 상위 이동 (루트에서는 상위 항목 미표시)
 * - 숨김 폴더(이름이 `.` 로 시작) 및 `node_modules` 는 목록에서 제외
 *
 * @param {import('node:readline/promises').Interface} rl
 * @param {string} startDir 절대 경로
 * @returns {Promise<string>} 선택한 html 파일의 절대 경로
 */
async function browsePickHtml(rl, startDir) {
  let current = path.resolve(startDir);

  while (true) {
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (e) {
      const err = /** @type {NodeJS.ErrnoException} */ (e);
      console.error(`폴더를 읽을 수 없습니다: ${current}\n  (${err.code ?? ""} ${err.message})`);
      current = path.dirname(current);
      continue;
    }

    const dirs = entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          e.name !== "node_modules",
      )
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    const htmlFiles = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".html"))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    const parent = path.dirname(current);
    const canUp = parent !== current;

    console.log(`\n현재 폴더:\n  ${current}\n`);

    /** @type {{ type: "up" | "dir" | "file"; abs: string; label: string }[]} */
    const items = [];
    let n = 1;
    if (canUp) {
      items.push({ type: "up", abs: parent, label: ".. (상위 폴더)" });
      console.log(`  [${n++}]  ${items[items.length - 1].label}`);
    }
    for (const d of dirs) {
      const abs = path.join(current, d);
      items.push({ type: "dir", abs, label: `[DIR]  ${d}/` });
      console.log(`  [${n++}]  ${items[items.length - 1].label}`);
    }
    for (const f of htmlFiles) {
      const abs = path.join(current, f);
      items.push({ type: "file", abs, label: `[FILE] ${f}` });
      console.log(`  [${n++}]  ${items[items.length - 1].label}`);
    }

    if (items.length === 0) {
      console.log("  (표시할 하위 폴더·html 파일 없음 — q 로 종료)");
    }

    const ans = (await rl.question("\n번호 입력 — 파일 고르기 | q 종료: "))
      .trim()
      .toLowerCase();
    if (ans === "q" || ans === "quit") {
      console.log("종료합니다.");
      process.exit(0);
    }
    const num = Number.parseInt(ans, 10);
    if (Number.isNaN(num) || num < 1 || num > items.length) {
      console.log("→ 올바른 번호를 입력하세요.\n");
      continue;
    }
    const picked = items[num - 1];
    if (picked.type === "file") {
      return picked.abs;
    }
    current = picked.abs;
  }
}

/**
 * `--rules` / `--marker` 를 반영한 marker·pairs.
 *
 * @param {string | null | undefined} cliMarker
 * @param {string} rulesPath
 */
async function resolveMarkerPairs(cliMarker, rulesPath) {
  /** @type {string | null} */
  let marker = DEFAULT_MARKER;
  let pairs = DEFAULT_PAIRS;

  if (rulesPath) {
    const loaded = await loadRulesFromFile(rulesPath);
    pairs = loaded.pairs;
    marker = loaded.marker;
  }
  if (cliMarker !== undefined) {
    marker = cliMarker;
  }
  return { marker, pairs };
}

/**
 * 읽기 → 변환 → 쓰기 한 번에 수행한다.
 *
 * @param {string} input
 * @param {string} output
 * @param {string | null} marker
 * @param {OpenClosePair[]} pairs
 */
async function writeTransformed(input, output, marker, pairs) {
  const html = await fs.readFile(input, "utf8");
  const out = applyTransforms(html, marker, pairs);
  await fs.writeFile(output, out, "utf8");
  console.log(
    "OK:",
    output === input ? `${output} (덮어쓰기)` : `${input} → ${output}`,
  );
}

/**
 * @param {{ startDir: string; cliMarker: string | null | undefined; rulesPath: string }} parsed
 * @returns {Promise<{ input: string; output: string }>}
 */
async function runInteractivePicker(parsed) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      "표준 입출력이 터미널이 아니라 대화형 선택을 할 수 없습니다.\n" +
        "예: node scripts/normalize-html-text-wrap.mjs -i ./path/to/file.html",
    );
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(
      "대화형 모드: 번호로 폴더에 들어가거나 .html 파일을 선택하세요.\n" +
        "(--rules / --marker 는 파일 선택 후 변환에 적용됩니다.)\n",
    );
    const input = await browsePickHtml(rl, parsed.startDir);

    const outLine = (
      await rl.question(
        "출력 HTML 경로 (Enter = 입력 파일과 동일·덮어쓰기, 상대 경로는 선택한 파일 폴더 기준): ",
      )
    ).trim();

    let output = input;
    if (outLine) {
      output = path.isAbsolute(outLine)
        ? path.normalize(outLine)
        : path.resolve(path.dirname(input), outLine);
    }

    return { input, output };
  } finally {
    rl.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseCli(argv);

  if (parsed.mode === "interactive") {
    const { input, output } = await runInteractivePicker(parsed);
    const { marker, pairs } = await resolveMarkerPairs(
      parsed.cliMarker,
      parsed.rulesPath,
    );
    await writeTransformed(input, output, marker, pairs);
    return;
  }

  const { marker, pairs } = await resolveMarkerPairs(
    parsed.cliMarker,
    parsed.rulesPath,
  );
  await writeTransformed(parsed.input, parsed.output, marker, pairs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
