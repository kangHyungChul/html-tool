/**
 * Playwright QA 실행 — Next API Route 전용 래퍼.
 * 정적 import를 이 파일에만 두고 route.ts는 동적 import로 연결하여 webpack이 playwright-core를 번들하지 않게 한다.
 */
import { generateMarkdownReport, serializeReportJson } from "@/qa/lib/generateReport";
import { runBusinessAreaQa } from "@/qa/lib/runBusinessAreaQa";
import type { QaPhaseResult, QaProgressEvent } from "@/qa/lib/types";

export interface RunQaViaApiInput {
    baselineUrl: string;
    targetUrl: string;
    localeKey: string;
    baselineXlsxBuffer: Buffer;
    targetXlsxBuffer: Buffer;
    signal?: AbortSignal;
    onProgress?: (event: QaProgressEvent) => void;
    onPhaseResult?: (result: QaPhaseResult) => void;
}

export async function runQaViaApi(input: RunQaViaApiInput) {
    const report = await runBusinessAreaQa(
        {
            baselineUrl: input.baselineUrl,
            targetUrl: input.targetUrl,
            localeKey: input.localeKey,
            baselineXlsxBuffer: input.baselineXlsxBuffer,
            targetXlsxBuffer: input.targetXlsxBuffer,
        },
        {
            signal: input.signal,
            onProgress: input.onProgress,
            onPhaseResult: input.onPhaseResult,
        },
    );

    return {
        report,
        markdown: generateMarkdownReport(report),
        json: serializeReportJson(report),
    };
}
