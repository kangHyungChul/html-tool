/**
 * Business Area QA API — 로컬 개발(`npm run dev`) 전용.
 * NDJSON 스트림으로 진행 상황을 전송하고, 클라이언트 중단(fetch abort)을 지원한다.
 */
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
    /** 클라이언트 fetch abort + ReadableStream cancel 을 QA 러너에 전달 */
    const abortController = new AbortController();
    const abortFromRequest = () => abortController.abort();
    request.signal.addEventListener("abort", abortFromRequest);

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const write = (line: StreamLine) => {
                if (abortController.signal.aborted) {
                    return;
                }
                try {
                    controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
                } catch {
                    /* 스트림이 닫힌 뒤 enqueue 시 무시 */
                }
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
                    return;
                }

                if (!(baselineFile instanceof File) || !(targetFile instanceof File)) {
                    write({ type: "error", message: "baselineXlsx, targetXlsx 파일을 업로드해 주세요." });
                    return;
                }

                const baselineXlsxBuffer = Buffer.from(await baselineFile.arrayBuffer());
                const targetXlsxBuffer = Buffer.from(await targetFile.arrayBuffer());

                const { runQaViaApi } = await import("./runQa.server");

                const result = await runQaViaApi({
                    baselineUrl,
                    targetUrl,
                    localeKey,
                    baselineXlsxBuffer,
                    targetXlsxBuffer,
                    signal: abortController.signal,
                    onProgress: (event) => write({ type: "progress", event }),
                });

                if (abortController.signal.aborted) {
                    write({ type: "cancelled" });
                    return;
                }

                write({
                    type: "complete",
                    report: result.report,
                    markdown: result.markdown,
                    json: result.json,
                });
            } catch (err) {
                if (
                    abortController.signal.aborted ||
                    (err instanceof Error && err.name === "AbortError")
                ) {
                    write({ type: "cancelled" });
                } else {
                    const message = err instanceof Error ? err.message : String(err);
                    write({ type: "error", message });
                }
            } finally {
                request.signal.removeEventListener("abort", abortFromRequest);
                controller.close();
            }
        },
        cancel() {
            abortController.abort();
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
