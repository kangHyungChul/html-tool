#!/usr/bin/env node

/**
 * html-to-cell-placeholders.mjs
 *
 * placeholderMap.config.json의 셀 값(value)을 기준으로 HTML 파일의 텍스트/일부 속성을
 * {A1}, {B12} 같은 셀 placeholder로 치환한다.
 *
 * 추가 생성 리포트:
 * - mapping-report.md: 전체 요약 리포트
 * - diff-report.md: 매핑 전후 변경사항 중심 리포트
 * - unresolved-report.md: 애매해서 처리하지 못한 항목 중심 리포트
 *
 * 설치:
 *   npm install cheerio
 *
 * - 템플릿이 `<!DOCTYPE>` 없는 조각(fragment)인 경우, cheerio 기본 `isDocument: true` 는
 *   `<html><head><body>` 로 감싸 `$.html()` 결과가 달라져 **같은 파일 덮어쓰기 후** 재실행 시
 *   엑셀 값과 텍스트가 더 이상 정확히 일치하지 않을 수 있다. 세 번째 인자 `false` 로 fragment 모드 사용.
 *
 * 실행:
 *   node scripts/html-to-cell-placeholders.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** `npm run` 이 프로젝트 루트에서 실행된다고 가정하고, CONFIG 상대 경로를 여기서 해석한다. */
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * CONFIG 에 적힌 경로를 절대 경로로 만든다.
 * - 이미 절대 경로면 그대로
 * - 아니면 프로젝트 루트 기준 (cwd 가 아님 — `cd scripts` 후 실행해도 동일하게 동작)
 *
 * @param {string} configPath
 */
function resolveProjectPath(configPath) {
    return path.isAbsolute(configPath)
        ? path.normalize(configPath)
        : path.resolve(PROJECT_ROOT, configPath);
}

/**
 * 입력·출력이 같은 파일일 때: 바로 덮어쓰면 일부 환경에서 깨질 수 있어
 * 임시 파일에 쓴 뒤 rename 으로 원자적으로 교체한다.
 *
 * @param {string} filePath
 * @param {string} content
 */
async function writeHtmlAtomicInPlace(filePath, content) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tmpPath = path.join(dir, `.${base}.${process.pid}.tmp`);
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
}

const CONFIG = {
    inputHtmlPath: './public/templates/business-area.cell-placeholder.mapped.html',
    inputJsonPath: './features/html-generator/constants/business-area-template.placeholder-map.config.json',

    outputHtmlPath: './public/templates/business-area.cell-placeholder.mapped_complete.html',
    // outputJsonPath: './output/placeholderMap.mapped.config.json',

    /**
     * 기존 통합 리포트
     */
    outputReportPath: './output/mapping-report.md',

    /**
     * 매핑 전후 diff 중심 리포트
     */
    outputDiffReportPath: './output/diff-report.md',

    /**
     * 애매해서 처리하지 못한 항목 중심 리포트
     */
    outputUnresolvedReportPath: './output/unresolved-report.md',

    exactTextNodeOnly: true,

    mapAttributes: {
        alt: true,
        title: false,
        ariaLabel: true
    },

    /**
     * 동일한 엑셀 값(정규화 후 동일)이 여러 셀에 있을 때:
     * - 'first': JSON 필드 순서상 **가장 앞에 나온 셀**의 placeholder만 사용 (ambiguous 리포트에 넣지 않음)
     * - 'skip': 매칭 포기 후 unresolved-report 등에 후보 목록 기록
     */
    duplicateValuePolicy: 'first',

    excludedTags: ['script', 'style', 'noscript', 'template', 'svg'],

    ignoreValues: ['', 'N/A', 'NA', '-', '—']
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

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeMarkdown(value) {
    return String(value)
        .replace(/\|/g, '\\|')
        .replace(/\n/g, '<br />');
}

function preserveOuterWhitespace(originalText, replacement) {
    const leading = originalText.match(/^\s*/)?.[0] ?? '';
    const trailing = originalText.match(/\s*$/)?.[0] ?? '';

    return `${leading}${replacement}${trailing}`;
}

function isInsideExcludedTag(node) {
    let current = node.parent;

    while (current) {
        if (current.type === 'tag' && CONFIG.excludedTags.includes(current.name)) {
            return true;
        }

        current = current.parent;
    }

    return false;
}

function getAllFields(mappingJson) {
    if (Array.isArray(mappingJson.fields) && mappingJson.fields.length > 0) {
        return mappingJson.fields;
    }

    const fields = [];

    if (Array.isArray(mappingJson.sheets)) {
        for (const sheet of mappingJson.sheets) {
            if (Array.isArray(sheet.fields)) {
                fields.push(...sheet.fields);
            }

            if (Array.isArray(sheet.sections)) {
                for (const section of sheet.sections) {
                    if (Array.isArray(section.fields)) {
                        fields.push(...section.fields.map((field) => ({
                            ...field,
                            sectionKey: section.key,
                            sectionLabel: section.label,
                            sheetName: sheet.sheetName
                        })));
                    }
                }
            }
        }
    }

    return fields;
}

function buildCandidateMap(fields) {
    const byNormalizedValue = new Map();

    // fields 배열 앞쪽이 우선: 동일 값이 여러 셀에 있으면 duplicateValuePolicy === 'first' 일 때 앞쪽 셀을 쓴다.
    for (const field of fields) {
        const value = normalizeValue(field.value);

        if (!field.cell || !value || shouldIgnoreValue(value)) {
            continue;
        }

        const normalized = normalizeForCompare(value);

        if (!byNormalizedValue.has(normalized)) {
            byNormalizedValue.set(normalized, []);
        }

        byNormalizedValue.get(normalized).push({
            ...field,
            value,
            placeholder: field.placeholder || `{${field.cell}}`
        });
    }

    return byNormalizedValue;
}

function getUniqueCandidate(candidateMap, text, ambiguousItems, htmlContext) {
    const normalized = normalizeForCompare(text);
    const candidates = candidateMap.get(normalized) ?? [];

    if (candidates.length === 0) {
        return null;
    }

    if (candidates.length === 1) {
        return candidates[0];
    }

    // 정규화 후 같은 값을 가진 셀이 여러 개일 때: 정책에 따라 첫 셀만 쓰거나 스킵한다.
    // buildCandidateMap 에서 push 순서 = getAllFields() 순서이므로 candidates[0] 이 "첫 번째 셀"이다.
    if (CONFIG.duplicateValuePolicy === 'first') {
        return candidates[0];
    }

    const ambiguousItem = {
        htmlText: normalizeValue(text),
        htmlContext,
        candidateCells: candidates.map((candidate) => candidate.cell),
        candidateValues: candidates.map((candidate) => ({
            cell: candidate.cell,
            value: candidate.value,
            label: candidate.label ?? ''
        })),
        reason: '동일하거나 정규화 후 동일한 엑셀 값이 여러 셀에 존재합니다.',
        question: '이 HTML 텍스트에는 어떤 엑셀 셀을 사용해야 하나요?'
    };

    ambiguousItems.push(ambiguousItem);

    return null;
}

function collectReplacementContext($, node) {
    const parent = node.parent;

    if (!parent || parent.type !== 'tag') {
        return 'text node';
    }

    const tagName = parent.name;
    const id = parent.attribs?.id ? `#${parent.attribs.id}` : '';
    const className = parent.attribs?.class
        ? `.${String(parent.attribs.class).split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`
        : '';

    return `${tagName}${id}${className}`;
}

function replaceTextNodes($, candidateMap, result) {
    const root = $.root();

    root.find('*').contents().each((_, node) => {
        if (node.type !== 'text') {
            return;
        }

        if (isInsideExcludedTag(node)) {
            return;
        }

        const originalText = node.data ?? '';
        const trimmed = normalizeValue(originalText);

        if (!trimmed) {
            return;
        }

        const htmlContext = collectReplacementContext($, node);
        const exactCandidate = getUniqueCandidate(candidateMap, trimmed, result.ambiguousItems, htmlContext);

        if (exactCandidate) {
            const placeholder = exactCandidate.placeholder;
            node.data = preserveOuterWhitespace(originalText, placeholder);

            result.replacements.push({
                type: 'text',
                cell: exactCandidate.cell,
                placeholder,
                before: trimmed,
                after: placeholder,
                originalText: trimmed,
                htmlContext
            });

            result.usedCells.add(exactCandidate.cell);
            return;
        }

        if (CONFIG.exactTextNodeOnly) {
            result.unmappedHtmlTexts.push({
                text: trimmed,
                htmlContext,
                reason: '일치하는 엑셀 셀 값을 찾지 못했습니다.'
            });
            return;
        }

        let changedText = originalText;
        const candidates = Array
            .from(candidateMap.values())
            .flat()
            .sort((a, b) => b.value.length - a.value.length);

        for (const candidate of candidates) {
            if (!candidate.value || candidate.value.length < 2) {
                continue;
            }

            const regex = new RegExp(escapeRegExp(candidate.value), 'g');

            if (!regex.test(changedText)) {
                continue;
            }

            changedText = changedText.replace(regex, candidate.placeholder);

            result.replacements.push({
                type: 'partial-text',
                cell: candidate.cell,
                placeholder: candidate.placeholder,
                before: candidate.value,
                after: candidate.placeholder,
                originalText: candidate.value,
                htmlContext
            });

            result.usedCells.add(candidate.cell);
        }

        if (changedText !== originalText) {
            node.data = changedText;
        } else {
            result.unmappedHtmlTexts.push({
                text: trimmed,
                htmlContext,
                reason: '부분 치환 모드에서도 일치하는 엑셀 셀 값을 찾지 못했습니다.'
            });
        }
    });
}

function replaceAttributes($, candidateMap, result) {
    const targetAttributes = [];

    if (CONFIG.mapAttributes.alt) {
        targetAttributes.push('alt');
    }

    if (CONFIG.mapAttributes.title) {
        targetAttributes.push('title');
    }

    if (CONFIG.mapAttributes.ariaLabel) {
        targetAttributes.push('aria-label');
    }

    if (targetAttributes.length === 0) {
        return;
    }

    $('*').each((_, element) => {
        if (element.type !== 'tag') {
            return;
        }

        if (CONFIG.excludedTags.includes(element.name)) {
            return;
        }

        for (const attributeName of targetAttributes) {
            const originalValue = element.attribs?.[attributeName];

            if (!originalValue) {
                continue;
            }

            const htmlContext = `${element.name}[${attributeName}]`;
            const candidate = getUniqueCandidate(candidateMap, originalValue, result.ambiguousItems, htmlContext);

            if (!candidate) {
                continue;
            }

            $(element).attr(attributeName, candidate.placeholder);

            result.replacements.push({
                type: `attribute:${attributeName}`,
                cell: candidate.cell,
                placeholder: candidate.placeholder,
                before: originalValue,
                after: candidate.placeholder,
                originalText: originalValue,
                htmlContext
            });

            result.usedCells.add(candidate.cell);
        }
    });
}

function updateMappingJson(mappingJson, replacements, ambiguousItems, unmappedHtmlTexts, unusedExcelCells) {
    const replacementContextsByCell = new Map();

    for (const replacement of replacements) {
        if (!replacementContextsByCell.has(replacement.cell)) {
            replacementContextsByCell.set(replacement.cell, []);
        }

        replacementContextsByCell.get(replacement.cell).push({
            type: replacement.type,
            htmlContext: replacement.htmlContext,
            before: replacement.before,
            after: replacement.after
        });
    }

    const fields = getAllFields(mappingJson);

    const updatedFields = fields.map((field) => {
        const contexts = replacementContextsByCell.get(field.cell) ?? [];

        if (contexts.length === 0) {
            return {
                ...field,
                status: field.status === 'mapped-source' ? 'unused' : field.status
            };
        }

        return {
            ...field,
            status: 'mapped',
            htmlContexts: contexts
        };
    });

    return {
        ...mappingJson,
        fields: updatedFields,
        ambiguousItems,
        unmappedHtmlTexts,
        unusedExcelCells
    };
}

function createMappingReport({
    inputHtmlPath,
    inputJsonPath,
    outputHtmlPath,
    replacements,
    ambiguousItems,
    unmappedHtmlTexts,
    unusedExcelCells
}) {
    const lines = [];

    lines.push('# Mapping Report');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Input HTML: ${inputHtmlPath}`);
    lines.push(`- Input JSON: ${inputJsonPath}`);
    lines.push(`- Output HTML: ${outputHtmlPath}`);
    lines.push(`- Replacements: ${replacements.length}`);
    lines.push(`- Ambiguous items: ${ambiguousItems.length}`);
    lines.push(`- Unmapped HTML text nodes: ${unmappedHtmlTexts.length}`);
    lines.push(`- Unused Excel cells: ${unusedExcelCells.length}`);
    lines.push('');
    lines.push('## Replacements');
    lines.push('');

    for (const replacement of replacements) {
        lines.push(`- ${replacement.placeholder} ← "${replacement.before}" (${replacement.type}, ${replacement.htmlContext})`);
    }

    if (replacements.length === 0) {
        lines.push('- None');
    }

    lines.push('');
    lines.push('## See Also');
    lines.push('');
    lines.push(`- Diff report: ${CONFIG.outputDiffReportPath}`);
    lines.push(`- Unresolved report: ${CONFIG.outputUnresolvedReportPath}`);
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function createDiffReport({
    inputHtmlPath,
    outputHtmlPath,
    replacements
}) {
    const lines = [];

    lines.push('# Diff Report');
    lines.push('');
    lines.push('HTML 콘텐츠가 `{셀주소}` placeholder로 치환된 항목만 정리한 리포트입니다.');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Input HTML: ${inputHtmlPath}`);
    lines.push(`- Output HTML: ${outputHtmlPath}`);
    lines.push(`- Changed items: ${replacements.length}`);
    lines.push('');
    lines.push('## Changed Items');
    lines.push('');

    if (replacements.length === 0) {
        lines.push('- None');
        lines.push('');
        return `${lines.join('\n')}\n`;
    }

    lines.push('| No | Cell | Type | HTML Context | Before | After |');
    lines.push('|---:|---|---|---|---|---|');

    replacements.forEach((replacement, index) => {
        lines.push([
            `| ${index + 1}`,
            escapeMarkdown(replacement.cell),
            escapeMarkdown(replacement.type),
            escapeMarkdown(replacement.htmlContext),
            escapeMarkdown(replacement.before),
            escapeMarkdown(replacement.after),
            '|'
        ].join(' | '));
    });

    lines.push('');
    lines.push('## Detailed Diffs');
    lines.push('');

    replacements.forEach((replacement, index) => {
        lines.push(`### ${index + 1}. ${replacement.placeholder}`);
        lines.push('');
        lines.push(`- Cell: ${replacement.cell}`);
        lines.push(`- Type: ${replacement.type}`);
        lines.push(`- HTML Context: ${replacement.htmlContext}`);
        lines.push('');
        lines.push('```diff');
        lines.push(`- ${replacement.before}`);
        lines.push(`+ ${replacement.after}`);
        lines.push('```');
        lines.push('');
    });

    return `${lines.join('\n')}\n`;
}

function createUnresolvedReport({
    ambiguousItems,
    unmappedHtmlTexts,
    unusedExcelCells
}) {
    const lines = [];

    lines.push('# Unresolved Mapping Report');
    lines.push('');
    lines.push('자동으로 확정하지 못한 항목을 정리한 리포트입니다.');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Ambiguous items: ${ambiguousItems.length}`);
    lines.push(`- Unmapped HTML text nodes: ${unmappedHtmlTexts.length}`);
    lines.push(`- Unused Excel cells: ${unusedExcelCells.length}`);
    lines.push('');
    lines.push('## Ambiguous Items');
    lines.push('');

    if (ambiguousItems.length === 0) {
        lines.push('- None');
    } else {
        ambiguousItems.forEach((item, index) => {
            lines.push(`### ${index + 1}. Ambiguous HTML Text`);
            lines.push('');
            lines.push(`- HTML Context: ${item.htmlContext ?? ''}`);
            lines.push(`- HTML Text: ${item.htmlText}`);
            lines.push(`- Candidate Cells: ${item.candidateCells.join(', ')}`);
            lines.push(`- Reason: ${item.reason}`);
            lines.push(`- Question: ${item.question}`);
            lines.push('');
            lines.push('| Cell | Value | Label |');
            lines.push('|---|---|---|');

            for (const candidate of item.candidateValues ?? []) {
                lines.push(`| ${escapeMarkdown(candidate.cell)} | ${escapeMarkdown(candidate.value)} | ${escapeMarkdown(candidate.label)} |`);
            }

            lines.push('');
        });
    }

    lines.push('');
    lines.push('## Unmapped HTML Texts');
    lines.push('');

    if (unmappedHtmlTexts.length === 0) {
        lines.push('- None');
    } else {
        lines.push('| No | HTML Context | Text | Reason |');
        lines.push('|---:|---|---|---|');

        unmappedHtmlTexts.slice(0, 300).forEach((item, index) => {
            lines.push(`| ${index + 1} | ${escapeMarkdown(item.htmlContext)} | ${escapeMarkdown(item.text)} | ${escapeMarkdown(item.reason)} |`);
        });

        if (unmappedHtmlTexts.length > 300) {
            lines.push(`| - | - | ...and ${unmappedHtmlTexts.length - 300} more | - |`);
        }
    }

    lines.push('');
    lines.push('## Unused Excel Cells');
    lines.push('');

    if (unusedExcelCells.length === 0) {
        lines.push('- None');
    } else {
        lines.push('| No | Cell | Value | Label |');
        lines.push('|---:|---|---|---|');

        unusedExcelCells.slice(0, 300).forEach((item, index) => {
            lines.push(`| ${index + 1} | ${escapeMarkdown(item.cell)} | ${escapeMarkdown(item.value)} | ${escapeMarkdown(item.label ?? '')} |`);
        });

        if (unusedExcelCells.length > 300) {
            lines.push(`| - | - | ...and ${unusedExcelCells.length - 300} more | - |`);
        }
    }

    lines.push('');
    lines.push('## User Questions');
    lines.push('');

    if (ambiguousItems.length === 0) {
        lines.push('- None');
    } else {
        ambiguousItems.forEach((item, index) => {
            lines.push(`${index + 1}. ${item.question}`);
            lines.push(`   - HTML Text: "${item.htmlText}"`);
            lines.push(`   - Candidate Cells: ${item.candidateCells.join(', ')}`);
        });
    }

    lines.push('');

    return `${lines.join('\n')}\n`;
}

async function ensureDirectory(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
    const inputHtmlPath = resolveProjectPath(CONFIG.inputHtmlPath);
    const inputJsonPath = resolveProjectPath(CONFIG.inputJsonPath);
    const outputHtmlPath = resolveProjectPath(CONFIG.outputHtmlPath);
    const outputReportPath = resolveProjectPath(CONFIG.outputReportPath);
    const outputDiffReportPath = resolveProjectPath(CONFIG.outputDiffReportPath);
    const outputUnresolvedReportPath = resolveProjectPath(CONFIG.outputUnresolvedReportPath);

    const [html, mappingJsonRaw] = await Promise.all([
        fs.readFile(inputHtmlPath, 'utf-8'),
        fs.readFile(inputJsonPath, 'utf-8')
    ]);

    const mappingJson = JSON.parse(mappingJsonRaw);
    const fields = getAllFields(mappingJson);
    const candidateMap = buildCandidateMap(fields);

    // 세 번째 인자 false: fragment 모드 — 문서 루트에 `<html>` 래퍼를 붙이지 않음 (인플레이스 덮어쓰기·재실행 시 일치 유지)
    const $ = load(
        html,
        {
            decodeEntities: false,
            xmlMode: false
        },
        false
    );

    const result = {
        replacements: [],
        ambiguousItems: [],
        unmappedHtmlTexts: [],
        usedCells: new Set()
    };

    replaceTextNodes($, candidateMap, result);
    replaceAttributes($, candidateMap, result);

    const unusedExcelCells = fields
        .filter((field) => field.cell && field.value && !shouldIgnoreValue(field.value))
        .filter((field) => !result.usedCells.has(field.cell))
        .map((field) => ({
            cell: field.cell,
            value: field.value,
            label: field.label ?? ''
        }));

    const outputHtml = $.html();
    // const updatedMappingJson = updateMappingJson(
    //     mappingJson,
    //     result.replacements,
    //     result.ambiguousItems,
    //     result.unmappedHtmlTexts,
    //     unusedExcelCells
    // );

    const mappingReport = createMappingReport({
        inputHtmlPath,
        inputJsonPath,
        outputHtmlPath,
        replacements: result.replacements,
        ambiguousItems: result.ambiguousItems,
        unmappedHtmlTexts: result.unmappedHtmlTexts,
        unusedExcelCells
    });

    const diffReport = createDiffReport({
        inputHtmlPath,
        outputHtmlPath,
        replacements: result.replacements
    });

    const unresolvedReport = createUnresolvedReport({
        ambiguousItems: result.ambiguousItems,
        unmappedHtmlTexts: result.unmappedHtmlTexts,
        unusedExcelCells
    });

    await ensureDirectory(outputHtmlPath);
    await ensureDirectory(outputReportPath);
    await ensureDirectory(outputDiffReportPath);
    await ensureDirectory(outputUnresolvedReportPath);
    // await ensureDirectory(CONFIG.outputJsonPath);

    const htmlOutIsInPlace =
        path.normalize(inputHtmlPath) === path.normalize(outputHtmlPath);

    await Promise.all([
        htmlOutIsInPlace
            ? writeHtmlAtomicInPlace(outputHtmlPath, outputHtml)
            : fs.writeFile(outputHtmlPath, outputHtml, 'utf-8'),
        fs.writeFile(outputReportPath, mappingReport, 'utf-8'),
        fs.writeFile(outputDiffReportPath, diffReport, 'utf-8'),
        fs.writeFile(outputUnresolvedReportPath, unresolvedReport, 'utf-8')
        // fs.writeFile(CONFIG.outputJsonPath, `${JSON.stringify(updatedMappingJson, null, 4)}\n`, 'utf-8')
    ]);

    console.log('HTML placeholder 치환 완료');
    console.log(`- Input HTML: ${inputHtmlPath}`);
    console.log(`- Input JSON: ${inputJsonPath}`);
    console.log(`- Output HTML: ${outputHtmlPath}${htmlOutIsInPlace ? ' (입력과 동일 경로·원자적 덮어쓰기)' : ''}`);
    console.log(`- Mapping report: ${outputReportPath}`);
    console.log(`- Diff report: ${outputDiffReportPath}`);
    console.log(`- Unresolved report: ${outputUnresolvedReportPath}`);
    console.log(`- Replacements: ${result.replacements.length}`);
    console.log(`- Ambiguous items: ${result.ambiguousItems.length}`);
    console.log(`- Unmapped HTML text nodes: ${result.unmappedHtmlTexts.length}`);
    console.log(`- Unused Excel cells: ${unusedExcelCells.length}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
