import type { BusinessAreaQaReport } from "./types";

function escapeMdCell(value: string, maxLen = 120): string {
    return value.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, maxLen);
}

function statusEmoji(status: string): string {
    if (status === "pass") {
        return "✅";
    }
    if (status === "fail") {
        return "❌";
    }
    if (status === "warn") {
        return "⚠️";
    }
    return "⏭️";
}

/** QA 결과를 Markdown 리포트 문자열로 변환 */
export function generateMarkdownReport(report: BusinessAreaQaReport): string {
    const { input, summary } = report;
    const lines: string[] = [];

    lines.push(`# Business Area QA Report`);
    lines.push("");
    lines.push(`- 생성 시각: ${report.generatedAt}`);
    lines.push(`- Locale: **${input.localeKey}**`);
    lines.push(`- 비교군 URL: ${input.baselineUrl}`);
    lines.push(`- 검증 URL: ${input.targetUrl}`);
    lines.push(`- 비교군 시트: ${input.baselineSheetName}`);
    lines.push(`- 검증 시트: ${input.targetSheetName}`);
    lines.push(`- **전체 결과: ${summary.overallPass ? "PASS ✅" : "FAIL ❌"}**`);
    lines.push("");

    lines.push("## 요약");
    lines.push("");
    lines.push("| 항목 | PASS | FAIL | SKIP |");
    lines.push("|------|------|------|------|");
    lines.push(
        `| 번역(동일 DOM·locale 엑셀) | ${summary.translation.pass} | ${summary.translation.fail} | ${summary.translation.skip} |`,
    );
    lines.push(
        `| 링크 경로(global/locale) | ${summary.linkLocaleRule.pass} | ${summary.linkLocaleRule.fail} | ${summary.linkLocaleRule.skip} |`,
    );
    lines.push(
        `| 링크 탐색(클릭/404) | ${summary.linkNavigation.pass} | ${summary.linkNavigation.fail} | ${summary.linkNavigation.skip} |`,
    );
    lines.push("");

    const failedTranslations = report.translations.filter((t) => t.status === "fail");
    if (failedTranslations.length > 0) {
        lines.push("## 번역 실패");
        lines.push("");
        lines.push("| 셀 | 라벨 | 기대 텍스트 | 페이지 실제 텍스트 |");
        lines.push("|----|------|------------|-------------------|");
        for (const item of failedTranslations) {
            lines.push(
                `| ${item.cell} | ${item.label} | ${escapeMdCell(item.expected)} | ${escapeMdCell(item.actual ?? "(미확인)")} |`,
            );
        }
        lines.push("");
    }

    const failedLocaleRules = report.linkLocaleRules.filter((l) => l.status === "fail");
    if (failedLocaleRules.length > 0) {
        lines.push("## 링크 경로 규칙 실패");
        lines.push("");
        for (const item of failedLocaleRules) {
            lines.push(`- ${statusEmoji(item.status)} \`${item.href}\` — ${item.detail ?? ""}`);
        }
        lines.push("");
    }

    const failedNav = report.linkNavigation.filter((l) => l.status === "fail");
    if (failedNav.length > 0) {
        lines.push("## 링크 탐색 실패 (404·클릭)");
        lines.push("");
        for (const item of failedNav) {
            const tabInfo = item.targetBlank ? `(새창: ${item.openedNewTab ? "열림" : "미열림"})` : "";
            lines.push(
                `- ${statusEmoji(item.status)} \`${item.href}\` ${tabInfo} — ${item.detail ?? ""}`,
            );
        }
        lines.push("");
    }

    if (summary.overallPass) {
        lines.push("## 상세");
        lines.push("");
        lines.push("모든 필수 검증 항목을 통과했습니다.");
    }

    return `${lines.join("\n")}\n`;
}

/** QA 결과 JSON (UI·CLI 저장용) */
export function serializeReportJson(report: BusinessAreaQaReport): string {
    return `${JSON.stringify(report, null, 2)}\n`;
}
