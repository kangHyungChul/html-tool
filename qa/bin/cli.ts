#!/usr/bin/env node
/**
 * Business Area QA CLI (독립 패키지 `business-area-qa`)
 *
 * 사용:
 *   cd qa && npm install && npm run install-browsers
 *   npm run qa -- --baseline-url "..." --baseline-xlsx "./deck.xlsx" ...
 *
 *   또는 Windows: business-area-qa.cmd 더블클릭 후 인자는 터미널에서
 *   또는: npx business-area-qa --help  (qa 폴더에서 npm link 후)
 */
import fs from "node:fs/promises";
import path from "node:path";

import { generateMarkdownReport, serializeReportJson } from "../lib/generateReport";
import { QA_PACKAGE_ROOT } from "../lib/projectRoot";
import { runBusinessAreaQa } from "../lib/runBusinessAreaQa";

const DEFAULT_OUTPUT_DIR = path.join(QA_PACKAGE_ROOT, "output");

interface CliArgs {
    baselineUrl: string;
    baselineXlsx: string;
    targetUrl: string;
    targetXlsx: string;
    locale: string;
    outputDir: string;
}

function printHelp(): void {
    process.stdout.write(`Business Area QA (Playwright) — 독립 CLI

옵션:
  --baseline-url URL       비교군(글로벌) 페이지 URL
  --baseline-xlsx PATH     글로벌 엑셀 (.xlsx) — global 시트 포함
  --target-url URL         검증 대상(로케일) 페이지 URL
  --target-xlsx PATH       로케일 엑셀 (.xlsx) — locale 키와 동일 시트명
  --locale KEY             locale-map 키 (예: uk, ca_en)
  --output-dir PATH        리포트 저장 폴더 (기본: qa/output)
  --help                   도움말

예:
  npm run qa -- --baseline-url "https://www.lg.com/global/business/about-lg-business/" \\
    --baseline-xlsx "./deck.xlsx" \\
    --target-url "https://www.lg.com/uk/business/about-lg-business/" \\
    --target-xlsx "./deck.xlsx" --locale uk

최초 1회: npm run install-browsers
`);
}

function parseArgs(argv: string[]): CliArgs | "help" | null {
    const map = new Map<string, string>();
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            return "help";
        }
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
            const val = argv[i + 1];
            if (!val || val.startsWith("--")) {
                process.stderr.write(`옵션 --${key} 에 값이 필요합니다.\n`);
                return null;
            }
            map.set(key, val);
            i += 1;
        }
    }

    const baselineUrl = map.get("baseline-url");
    const baselineXlsx = map.get("baseline-xlsx");
    const targetUrl = map.get("target-url");
    const targetXlsx = map.get("target-xlsx");
    const locale = map.get("locale");

    if (!baselineUrl || !baselineXlsx || !targetUrl || !targetXlsx || !locale) {
        process.stderr.write(
            "필수 옵션이 누락되었습니다: --baseline-url, --baseline-xlsx, --target-url, --target-xlsx, --locale\n",
        );
        process.stderr.write("도움말: npm run qa -- --help\n");
        return null;
    }

    return {
        baselineUrl,
        baselineXlsx: path.resolve(baselineXlsx),
        targetUrl,
        targetXlsx: path.resolve(targetXlsx),
        locale,
        outputDir: map.get("output-dir")
            ? path.resolve(map.get("output-dir")!)
            : DEFAULT_OUTPUT_DIR,
    };
}

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed === "help") {
        printHelp();
        return;
    }
    if (!parsed) {
        process.exit(1);
    }

    process.stderr.write("QA 실행 중… (Playwright headless)\n");

    const baselineBuffer = await fs.readFile(parsed.baselineXlsx);
    const targetBuffer = await fs.readFile(parsed.targetXlsx);

    const report = await runBusinessAreaQa({
        baselineUrl: parsed.baselineUrl,
        targetUrl: parsed.targetUrl,
        localeKey: parsed.locale,
        baselineXlsxBuffer: baselineBuffer,
        targetXlsxBuffer: targetBuffer,
    });

    await fs.mkdir(parsed.outputDir, { recursive: true });
    const stamp = report.generatedAt.replace(/[:.]/g, "-");
    const mdPath = path.join(parsed.outputDir, `qa-report-${parsed.locale}-${stamp}.md`);
    const jsonPath = path.join(parsed.outputDir, `qa-report-${parsed.locale}-${stamp}.json`);

    await fs.writeFile(mdPath, generateMarkdownReport(report), "utf-8");
    await fs.writeFile(jsonPath, serializeReportJson(report), "utf-8");

    process.stdout.write(generateMarkdownReport(report));
    process.stderr.write(`\n리포트 저장: ${mdPath}\n`);
    process.stderr.write(`JSON 저장: ${jsonPath}\n`);
    process.stderr.write(`전체 결과: ${report.summary.overallPass ? "PASS" : "FAIL"}\n`);

    if (!report.summary.overallPass) {
        process.exit(1);
    }
}

main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
