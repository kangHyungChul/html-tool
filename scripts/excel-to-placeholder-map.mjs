#!/usr/bin/env node

/**
 * excel-to-placeholder-map.mjs
 *
 * 엑셀 파일을 읽어 {셀주소} placeholder 기반 JSON 매핑 메타데이터를 생성한다.
 *
 * 설치:
 *   npm install xlsx
 *
 * 실행 예:
 *   node scripts/excel-to-placeholder-map.mjs
 *   node scripts/excel-to-placeholder-map.mjs --body-range A4:H42
 *   node scripts/excel-to-placeholder-map.mjs --sheets global_en
 *   node scripts/excel-to-placeholder-map.mjs -s "Sheet1,Sheet2" -B A4:H42
 *   npm run map:excel -- --body-range A4:H42 -s global_en
 *
 * npm 에서 인자 넘기기: `npm run map:excel` 과 스크립트 옵션 사이에 **반드시 `--`** 가 필요하다.
 *   (동작 안 함) npm run map:excel --body-range A4:H42
 *   (동작 함)   npm run map:excel -- --body-range A4:H42
 *
 * 옵션:
 *   --body-range, -B   본문 등 스캔할 A1 범위만 지정. 생략·빈 문자열·"null" → 시트 !ref 전체
 *   --sheets, -s       쉼표로 구분한 시트명만 처리. 생략·빈 문자열·"null"·"all" → 워크북의 모든 시트
 *   -h, --help         도움말
 *
 * CONFIG.sheetNames / CONFIG.rangesBySheet 가 비어 있지 않으면 CLI 가 우선한다(시트·본문 범위).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const CONFIG = {
    excelFilePath: './public/example/business_area_template.xlsx',
    outputJsonPath: './features/html-generator/constants/business-area-template.placeholder-map.config.json',

    /**
     * 특정 시트만 처리하고 싶으면 배열에 시트명을 넣는다.
     * 빈 배열이면 모든 시트를 처리한다.
     */
    sheetNames: [],

    /**
     * 특정 범위만 스캔하고 싶으면 시트별 range를 지정한다.
     * null이면 시트 전체를 스캔한다.
     */
    rangesBySheet: null,

    ignoreValues: ['', 'N/A', 'NA', '-', '—'],
    includeIgnoredValues: false,
    useFormattedCellValue: true,
    textareaLengthThreshold: 80,
    multilineAsTextarea: true,

    /**
     * 출력 JSON `excelLayout`: 엑셀 시트 상단 «타이틀/메타» 행(1-based inclusive).
     * 본문 카피 시작 행과 맞추려면 `mainContentFirstRow` 를 시트 range 첫 행과 동일하게 둔다.
     */
    excelLayout: {
        sheetTitleRowRange: { startRow: 2, endRow: 3 },
        mainContentFirstRow: 4
    }
};

function normalizeValue(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

function normalizeForCompare(value) {
    return normalizeValue(value)
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function shouldIgnoreValue(value) {
    const normalized = normalizeForCompare(value);

    return CONFIG.ignoreValues.some((ignoreValue) => {
        return normalizeForCompare(ignoreValue) === normalized;
    });
}

function getCellDisplayValue(worksheet, cellAddress) {
    const cell = worksheet[cellAddress];

    if (!cell) {
        return '';
    }

    if (CONFIG.useFormattedCellValue) {
        const formatted = XLSX.utils.format_cell(cell);
        return normalizeValue(formatted);
    }

    return normalizeValue(cell.v);
}

function getInputMeta(value) {
    const hasLineBreak = value.includes('\n');
    const isLong = value.length >= CONFIG.textareaLengthThreshold;

    if ((CONFIG.multilineAsTextarea && hasLineBreak) || isLong) {
        return {
            inputType: 'textarea',
            multiline: hasLineBreak
        };
    }

    return {
        inputType: 'text',
        multiline: false
    };
}

/**
 * 스캔할 셀 범위를 디코드한다.
 * 우선순위: CONFIG.rangesBySheet[시트명] → CLI 본문 범위(모든 대상 시트 공통) → 시트 !ref 전체
 *
 * @param {import('xlsx').WorkSheet} worksheet
 * @param {string} sheetName
 * @param {{ bodyRange: string | null }} runOpts
 */
function decodeRange(worksheet, sheetName, runOpts) {
    const configuredRange = CONFIG.rangesBySheet?.[sheetName];

    if (configuredRange) {
        return XLSX.utils.decode_range(configuredRange);
    }

    if (runOpts.bodyRange) {
        return XLSX.utils.decode_range(runOpts.bodyRange);
    }

    if (!worksheet['!ref']) {
        return null;
    }

    return XLSX.utils.decode_range(worksheet['!ref']);
}

function createField({ sheetName, cellAddress, value }) {
    const inputMeta = getInputMeta(value);

    return {
        sheetName,
        cell: cellAddress,
        placeholder: `{${cellAddress}}`,
        label: `${sheetName} ${cellAddress}`,
        value,
        htmlContext: '',
        inputType: inputMeta.inputType,
        required: false,
        multiline: inputMeta.multiline,
        status: 'mapped-source'
    };
}

async function ensureDirectory(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

/**
 * CLI `--sheets` 값: null/빈/all → 전체 시트, 아니면 쉼표 분리 시트명 배열
 *
 * @param {string | undefined} raw
 * @returns {string[] | null} null 이면 «전체 시트» 의미
 */
function parseSheetsCli(raw) {
    if (raw === undefined) {
        return null;
    }
    const t = String(raw).trim();
    if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'all') {
        return null;
    }
    return t.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * CLI `--body-range` 값: null/빈/null 문자열 → 전체 !ref, 아니면 A1 스타일 범위
 *
 * @param {string | undefined} raw
 */
function parseBodyRangeCli(raw) {
    if (raw === undefined) {
        return null;
    }
    const t = String(raw).trim();
    if (!t || t.toLowerCase() === 'null') {
        return null;
    }
    let decoded;
    try {
        decoded = XLSX.utils.decode_range(t);
    } catch {
        throw new Error(`--body-range 값이 올바른 A1 범위가 아닙니다: ${t}`);
    }
    const ok =
        decoded.s.r >= 0 &&
        decoded.s.c >= 0 &&
        decoded.e.r >= 0 &&
        decoded.e.c >= 0 &&
        decoded.s.r <= decoded.e.r &&
        decoded.s.c <= decoded.e.c;
    if (!ok) {
        throw new Error(`--body-range 값이 올바른 A1 범위가 아닙니다: ${t}`);
    }
    return t;
}

/**
 * @returns {{
 *   bodyRange: string | null,
 *   sheetNames: string[] | null,
 *   sheetsFromCli: boolean,
 *   help: boolean,
 *   invalid: boolean
 * }}
 */
function parseCli(argv) {
    /** @type {string | null} */
    let bodyRange = null;
    /** @type {string[] | null} */
    let sheetNames = null;
    /** true 이면 -s/--sheets 플래그를 한 번이라도 썼다(값이 null·all 이면 «워크북 전체 시트»로 해석) */
    let sheetsFromCli = false;

    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '-h' || a === '--help') {
            return {
                bodyRange: null,
                sheetNames: null,
                sheetsFromCli: false,
                help: true,
                invalid: false
            };
        }
        if (a === '--body-range' || a === '-B') {
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith('-')) {
                bodyRange = parseBodyRangeCli(next);
                i += 1;
            }
            continue;
        }
        if (a === '--sheets' || a === '-s') {
            sheetsFromCli = true;
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith('-')) {
                sheetNames = parseSheetsCli(next);
                i += 1;
            } else {
                sheetNames = null;
            }
            continue;
        }
        console.error(`알 수 없는 인자: ${a}\n`);
        return {
            bodyRange: null,
            sheetNames: null,
            sheetsFromCli: false,
            help: true,
            invalid: true
        };
    }

    return { bodyRange, sheetNames, sheetsFromCli, help: false, invalid: false };
}

function printHelp() {
    console.log(`
excel-to-placeholder-map.mjs — 엑셀 → placeholder-map JSON

사용법:
  node scripts/excel-to-placeholder-map.mjs [옵션]

옵션:
  -B, --body-range <A1범위>   본문만 스캔할 범위 (예: A4:H42). 생략·""·null → 시트 전체(!ref)
  -s, --sheets <이름들>       쉼표로 구분한 시트만 (예: global_en 또는 "Sheet1,Sheet2").
                              플래그만 쓰고 값을 비우거나 null·all 이면 워크북의 모든 시트(CONFIG.sheetNames 무시)
  -h, --help                  도움말

CONFIG(파일 상단)의 excelFilePath·outputJsonPath 는 그대로 사용한다.
  -s/--sheets 를 생략하면 CONFIG.sheetNames(비어 있으면 워크북 전체)를 쓴다.
  -s/--sheets 를 주면 CONFIG.sheetNames 는 무시하고, 값이 비어 있거나 null·all 이면 워크북 전체 시트다.
  --body-range 는 해당 시트에 CONFIG.rangesBySheet[시트명] 이 없을 때만 적용된다(있으면 파일 설정 우선).
`);
}

async function main() {
    const cli = parseCli(process.argv.slice(2));
    if (cli.help) {
        printHelp();
        process.exit(cli.invalid ? 1 : 0);
    }

    /** @type {{ bodyRange: string | null }} */
    const runOpts = { bodyRange: cli.bodyRange };

    const excelPath = path.isAbsolute(CONFIG.excelFilePath)
        ? CONFIG.excelFilePath
        : path.resolve(PROJECT_ROOT, CONFIG.excelFilePath);

    const workbook = XLSX.readFile(excelPath, {
        cellDates: true,
        cellNF: true,
        cellText: true
    });

    // -s/--sheets 를 썼으면 CLI 만 따른다: 값이 있으면 해당 시트만, null·all·빈 값이면 워크북 전체
    // 플래그를 안 썼으면 CONFIG.sheetNames → 비어 있으면 워크북 전체
    let targetSheetNames;
    if (cli.sheetsFromCli) {
        targetSheetNames =
            cli.sheetNames && cli.sheetNames.length > 0 ? cli.sheetNames : workbook.SheetNames;
    } else if (CONFIG.sheetNames.length > 0) {
        targetSheetNames = CONFIG.sheetNames;
    } else {
        targetSheetNames = workbook.SheetNames;
    }

    const fields = [];
    const sheets = [];

    for (const sheetName of targetSheetNames) {
        const worksheet = workbook.Sheets[sheetName];

        if (!worksheet) {
            throw new Error(`시트를 찾을 수 없습니다: ${sheetName}`);
        }

        const range = decodeRange(worksheet, sheetName, runOpts);

        if (!range) {
            sheets.push({
                sheetName,
                fields: []
            });
            continue;
        }

        const sheetFields = [];

        for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
            for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
                const cellAddress = XLSX.utils.encode_cell({
                    r: rowIndex,
                    c: columnIndex
                });

                const value = getCellDisplayValue(worksheet, cellAddress);
                const ignored = shouldIgnoreValue(value);

                if (!CONFIG.includeIgnoredValues && ignored) {
                    continue;
                }

                const field = createField({
                    sheetName,
                    cellAddress,
                    value
                });

                field.ignored = ignored;

                fields.push(field);
                sheetFields.push(field);
            }
        }

        const rangeLabel =
            CONFIG.rangesBySheet?.[sheetName] ?? runOpts.bodyRange ?? worksheet['!ref'] ?? '';

        sheets.push({
            sheetName,
            range: rangeLabel,
            fields: sheetFields
        });
    }

    const result = {
        version: '1.0',
        mappingType: 'excel-cell-placeholder',
        placeholderPattern: '\\{([A-Z]+[0-9]+)\\}',
        source: {
            excelFile: path.relative(PROJECT_ROOT, excelPath).replace(/\\/g, '/') || CONFIG.excelFilePath
        },
        options: {
            ignoreValues: CONFIG.ignoreValues,
            includeIgnoredValues: CONFIG.includeIgnoredValues,
            useFormattedCellValue: CONFIG.useFormattedCellValue
        },
        excelLayout: CONFIG.excelLayout,
        sheets,
        fields,
        ambiguousItems: [],
        unmappedHtmlTexts: [],
        unusedExcelCells: [],
        questions: []
    };

    const outPath = path.isAbsolute(CONFIG.outputJsonPath)
        ? CONFIG.outputJsonPath
        : path.resolve(PROJECT_ROOT, CONFIG.outputJsonPath);

    await ensureDirectory(outPath);
    await fs.writeFile(outPath, `${JSON.stringify(result, null, 4)}\n`, 'utf-8');

    console.log('placeholder map JSON 생성 완료');
    console.log(`- Excel: ${excelPath}`);
    console.log(`- Output: ${outPath}`);
    console.log(
        `- Sheets (${targetSheetNames.length}): ${targetSheetNames.join(', ') || '(none)'}`,
    );
    console.log(
        `- Body range: ${runOpts.bodyRange ?? '(시트 전체, CONFIG.rangesBySheet·!ref)'}`,
    );
    console.log(`- Fields: ${fields.length}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
