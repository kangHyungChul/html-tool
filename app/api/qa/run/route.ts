/**
 * Business Area QA API — 로컬 개발(`npm run dev`) 전용.
 * NDJSON 스트림으로 진행 상황을 전송하고, `request.signal` 로 중단을 지원한다.
 */
import { generateMarkdownReport, serializeReportJson } from "@/qa/lib/generateReport";
import { runBusinessAreaQa } from "@/qa/lib/runBusinessAreaQa";
import type { QaProgressEvent } from "@/qa/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type StreamLine =
    | { type: "progress"; event: QaProgressEvent }
    | { type: "complete"; report: unknown; markdown: string; json: string }
    | { type: "cancelled" }
    | { type: "error"; message: string };

export async function POST(request: Request): Promise<Response> {
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const write = (line: StreamLine) => {
                controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
            };

            try {
                const form = await request.formData();

                const baselineUrl = String(form.get("baselineUrl") ?? "").trim();
                const targetUrl = String(form.get("targetUrl") ?? "").trim();
                const localeKey = String(form.get("localeKey") ?? "").trim();
                const baselineFile = form.get("baselineXlsx");
                const targetFile = form.get("targetXlsx");

                if (!baselineUrl || !targetUrl || !localeKey) {
                    write({ type: "error", message: "baselineUrl, targetUrl, localeKey 는 필수입니다." });
                    controller.close();
                    return;
                }

                if (!(baselineFile instanceof File) || !(targetFile instanceof File)) {
                    write({ type: "error", message: "baselineXlsx, targetXlsx 파일을 업로드해 주세요." });
                    controller.close();
                    return;
                }

                const baselineXlsxBuffer = Buffer.from(await baselineFile.arrayBuffer());
                const targetXlsxBuffer = Buffer.from(await targetFile.arrayBuffer());

                const report = await runBusinessAreaQa(
                    {
                        baselineUrl,
                        targetUrl,
                        localeKey,
                        baselineXlsxBuffer,
                        targetXlsxBuffer,
                    },
                    {
                        signal: request.signal,
                        onProgress: (event) => write({ type: "progress", event }),
                    },
                );

                write({
                    type: "complete",
                    report,
                    markdown: generateMarkdownReport(report),
                    json: serializeReportJson(report),
                });
            } catch (err) {
                if (request.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
                    write({ type: "cancelled" });
                } else {
                    const message = err instanceof Error ? err.message : String(err);
                    write({ type: "error", message });
                }
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}
