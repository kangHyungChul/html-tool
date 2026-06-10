"use client";

/**
 * Business Area QA 설정 UI.
 * - QA 실행 중 폼 잠금 + 중단 버튼 + 진행 상황 표시
 * - POST /api/qa/run NDJSON 스트림 수신
 */

import localeMapJson from "@/features/html-generator/constants/locale-map.json";
import { buildQaTargetPageUrl, QA_DEFAULT_BASELINE_URL } from "@/qa/lib/qaPageUrls";
import type { BusinessAreaQaReport, QaProgressEvent, QaProgressPhase } from "@/qa/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

const LOCALE_KEYS = Object.keys(localeMapJson as Record<string, unknown>).filter((k) => k !== "global");

/** UI에 표시할 진행 단계 정의 */
const PROGRESS_STEPS: { phase: QaProgressPhase; label: string }[] = [
    { phase: "excel", label: "엑셀 파싱" },
    { phase: "browser", label: "브라우저 시작" },
    { phase: "page-load", label: "페이지 로드" },
    { phase: "business-area", label: "Business Area 탐색" },
    { phase: "translation", label: "번역 검증" },
    { phase: "link-extract", label: "링크 추출" },
    { phase: "link-locale", label: "링크 경로 검증" },
    { phase: "link-navigation", label: "링크 클릭·404 검증" },
    { phase: "done", label: "완료" },
];

const PHASE_ORDER = PROGRESS_STEPS.map((s) => s.phase);

function phaseIndex(phase: QaProgressPhase): number {
    return PHASE_ORDER.indexOf(phase);
}

type StreamLine =
    | { type: "progress"; event: QaProgressEvent }
    | { type: "complete"; report: BusinessAreaQaReport; markdown: string }
    | { type: "cancelled" }
    | { type: "error"; message: string };

export default function QaPage() {
    const [baselineUrl, setBaselineUrl] = useState(QA_DEFAULT_BASELINE_URL);
    const [targetUrl, setTargetUrl] = useState(() => buildQaTargetPageUrl("uk"));
    const [localeKey, setLocaleKey] = useState("uk");
    const [baselineXlsx, setBaselineXlsx] = useState<File | null>(null);
    const [targetXlsx, setTargetXlsx] = useState<File | null>(null);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cancelled, setCancelled] = useState(false);
    const [report, setReport] = useState<BusinessAreaQaReport | null>(null);
    const [markdown, setMarkdown] = useState<string | null>(null);
    const [progress, setProgress] = useState<QaProgressEvent | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    /** locale 키 변경 시 검증 URL을 about-lg-business 경로로 맞춤 */
    const prevLocaleRef = useRef(localeKey);

    useEffect(() => {
        if (prevLocaleRef.current === localeKey) {
            return;
        }
        prevLocaleRef.current = localeKey;
        setTargetUrl(buildQaTargetPageUrl(localeKey));
    }, [localeKey]);

    const cliHint = useMemo(() => {
        return `npm run qa -- \\
  --baseline-url "${baselineUrl}" \\
  --baseline-xlsx "./copydeck.xlsx" \\
  --target-url "${targetUrl}" \\
  --target-xlsx "./copydeck.xlsx" \\
  --locale ${localeKey}`;
    }, [baselineUrl, targetUrl, localeKey]);

    const handleCancel = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    const handleSubmit = useCallback(
        async (e: FormEvent) => {
            e.preventDefault();
            setError(null);
            setCancelled(false);
            setReport(null);
            setMarkdown(null);
            setProgress(null);

            if (!baselineXlsx || !targetXlsx) {
                setError("비교군·검증 대상 엑셀 파일을 모두 선택해 주세요.");
                return;
            }
            if (!targetUrl.trim()) {
                setError("검증 대상 URL을 입력해 주세요.");
                return;
            }
            const form = new FormData();
            form.append("baselineUrl", baselineUrl.trim());
            form.append("targetUrl", targetUrl.trim());
            form.append("localeKey", localeKey.trim());
            form.append("baselineXlsx", baselineXlsx);
            form.append("targetXlsx", targetXlsx);

            const controller = new AbortController();
            abortRef.current = controller;
            setRunning(true);

            try {
                const res = await fetch("/api/qa/run", {
                    method: "POST",
                    body: form,
                    signal: controller.signal,
                });

                if (!res.ok || !res.body) {
                    setError(`QA 요청 실패 (HTTP ${res.status})`);
                    return;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";

                    for (const line of lines) {
                        if (!line.trim()) {
                            continue;
                        }

                        const data = JSON.parse(line) as StreamLine;

                        if (data.type === "progress") {
                            setProgress(data.event);
                        } else if (data.type === "complete") {
                            setReport(data.report);
                            setMarkdown(data.markdown);
                        } else if (data.type === "cancelled") {
                            setCancelled(true);
                        } else if (data.type === "error") {
                            setError(data.message);
                        }
                    }
                }
            } catch (err) {
                if (err instanceof Error && err.name === "AbortError") {
                    setCancelled(true);
                } else {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "QA 요청 실패 — 로컬에서 `npm run dev` 가 실행 중인지 확인해 주세요.",
                    );
                }
            } finally {
                abortRef.current = null;
                setRunning(false);
            }
        },
        [baselineUrl, targetUrl, localeKey, baselineXlsx, targetXlsx],
    );

    const downloadMarkdown = useCallback(() => {
        if (!markdown || !report) {
            return;
        }
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `qa-report-${report.input.localeKey}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }, [markdown, report]);

    const currentPhaseIdx = progress ? phaseIndex(progress.phase) : -1;

    return (
        <main className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto p-4 md:gap-6 md:p-8">
            <header className="border-b border-zinc-200 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Business Area QA</h1>
                    <Link
                        href="/"
                        className="text-sm font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
                    >
                        ← 번역 적용 툴
                    </Link>
                </div>
                <p className="mt-2 text-sm text-zinc-600">
                    AEM에 어셈블된 로케일 페이지와 카피덱 엑셀을 Playwright로 비교합니다.
                    Business Area 컴포넌트는{" "}
                    <code className="rounded bg-zinc-100 px-1">/business/about-lg-business/</code> 페이지에
                    있습니다.
                </p>
            </header>

            <form
                onSubmit={handleSubmit}
                className={`flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm md:p-6 ${running ? "opacity-90" : ""}`}
            >
                <fieldset disabled={running} className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
                    <legend className="text-sm font-semibold text-zinc-800 mb-1">비교군 (Global)</legend>
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium text-zinc-700">Global 페이지 URL</span>
                        <input
                            type="url"
                            required
                            value={baselineUrl}
                            onChange={(ev) => setBaselineUrl(ev.target.value)}
                            className="rounded-md border border-zinc-300 px-3 py-2 disabled:bg-zinc-100 disabled:text-zinc-500"
                            placeholder="https://www.lg.com/global/business/about-lg-business/"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium text-zinc-700">Global 엑셀 (.xlsx, global 시트)</span>
                        <input
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            required
                            disabled={running}
                            onChange={(ev) => setBaselineXlsx(ev.target.files?.[0] ?? null)}
                            className="text-sm disabled:opacity-60"
                        />
                        {baselineXlsx ? (
                            <span className="text-xs text-zinc-500">{baselineXlsx.name}</span>
                        ) : null}
                    </label>
                </fieldset>

                <fieldset
                    disabled={running}
                    className="flex flex-col gap-3 border-0 border-t border-zinc-100 pt-4 p-0 m-0 min-w-0"
                >
                    <legend className="text-sm font-semibold text-zinc-800 mb-1">검증 대상 (Locale)</legend>
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium text-zinc-700">Locale 키 (엑셀 시트명과 1:1)</span>
                        <select
                            value={localeKey}
                            disabled={running}
                            onChange={(ev) => setLocaleKey(ev.target.value)}
                            className="rounded-md border border-zinc-300 px-3 py-2 disabled:bg-zinc-100"
                        >
                            {LOCALE_KEYS.map((key) => (
                                <option key={key} value={key}>
                                    {key}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium text-zinc-700">로케일 페이지 URL</span>
                        <input
                            type="url"
                            required
                            value={targetUrl}
                            onChange={(ev) => setTargetUrl(ev.target.value)}
                            className="rounded-md border border-zinc-300 px-3 py-2 disabled:bg-zinc-100 disabled:text-zinc-500"
                            placeholder={`https://www.lg.com/${localeKey}/business/about-lg-business/`}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium text-zinc-700">로케일 엑셀 (.xlsx, {localeKey} 시트)</span>
                        <input
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            required
                            disabled={running}
                            onChange={(ev) => setTargetXlsx(ev.target.files?.[0] ?? null)}
                            className="text-sm disabled:opacity-60"
                        />
                        {targetXlsx ? (
                            <span className="text-xs text-zinc-500">{targetXlsx.name}</span>
                        ) : null}
                    </label>
                </fieldset>

                <div className="mt-2 flex flex-wrap gap-2">
                    {!running ? (
                        <button
                            type="submit"
                            className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
                        >
                            QA 실행
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="inline-flex items-center justify-center rounded-md border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800 hover:bg-red-100"
                        >
                            중단
                        </button>
                    )}
                </div>
            </form>

            {running || progress ? (
                <section
                    className="rounded-lg border border-blue-200 bg-blue-50 p-4"
                    role="status"
                    aria-live="polite"
                >
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-blue-900">진행 상황</h2>
                        {progress ? (
                            <span className="text-xs font-medium text-blue-800">{progress.percent}%</span>
                        ) : null}
                    </div>

                    {progress ? (
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                            <div
                                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                                style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
                            />
                        </div>
                    ) : null}

                    {progress?.message ? (
                        <p className="mt-2 text-sm text-blue-900">{progress.message}</p>
                    ) : null}

                    <ol className="mt-3 space-y-1 text-sm">
                        {PROGRESS_STEPS.map((step, idx) => {
                            let state: "pending" | "active" | "done" = "pending";
                            if (currentPhaseIdx > idx) {
                                state = "done";
                            } else if (currentPhaseIdx === idx) {
                                state = "active";
                            }

                            return (
                                <li
                                    key={step.phase}
                                    className={
                                        state === "active"
                                            ? "font-medium text-blue-900"
                                            : state === "done"
                                              ? "text-green-800"
                                              : "text-zinc-500"
                                    }
                                >
                                    {state === "done" ? "✓ " : state === "active" ? "▶ " : "○ "}
                                    {step.label}
                                    {step.phase === "link-navigation" &&
                                    progress?.phase === "link-navigation" &&
                                    progress.total
                                        ? ` (${progress.current ?? 0}/${progress.total})`
                                        : null}
                                </li>
                            );
                        })}
                    </ol>
                </section>
            ) : null}

            <section className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm">
                <h2 className="font-semibold text-zinc-800">CLI로 실행</h2>
                <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{cliHint}</pre>
            </section>

            {cancelled ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                    QA가 중단되었습니다.
                </p>
            ) : null}

            {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                    {error}
                </p>
            ) : null}

            {report ? (
                <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold">
                            결과:{" "}
                            <span className={report.summary.overallPass ? "text-green-700" : "text-red-700"}>
                                {report.summary.overallPass ? "PASS" : "FAIL"}
                            </span>
                        </h2>
                        {markdown ? (
                            <button
                                type="button"
                                onClick={downloadMarkdown}
                                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
                            >
                                리포트 .md 다운로드
                            </button>
                        ) : null}
                    </div>

                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-zinc-200">
                                <th className="py-2 pr-2">항목</th>
                                <th className="py-2 px-2">PASS</th>
                                <th className="py-2 px-2">FAIL</th>
                                <th className="py-2 pl-2">SKIP</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="border-b border-zinc-100">
                                <td className="py-2 pr-2">번역 (엑셀→DOM)</td>
                                <td className="px-2">{report.summary.translation.pass}</td>
                                <td className="px-2 text-red-700">{report.summary.translation.fail}</td>
                                <td className="pl-2">{report.summary.translation.skip}</td>
                            </tr>
                            <tr className="border-b border-zinc-100">
                                <td className="py-2 pr-2">링크 경로 (global/locale)</td>
                                <td className="px-2">{report.summary.linkLocaleRule.pass}</td>
                                <td className="px-2 text-red-700">{report.summary.linkLocaleRule.fail}</td>
                                <td className="pl-2">{report.summary.linkLocaleRule.skip}</td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-2">링크 탐색 (클릭/404)</td>
                                <td className="px-2">{report.summary.linkNavigation.pass}</td>
                                <td className="px-2 text-red-700">{report.summary.linkNavigation.fail}</td>
                                <td className="pl-2">{report.summary.linkNavigation.skip}</td>
                            </tr>
                        </tbody>
                    </table>

                    {report.translations.filter((t) => t.status === "fail").length > 0 ? (
                        <details className="mt-2" open>
                            <summary className="cursor-pointer text-sm font-medium text-red-800">
                                번역 실패 상세 ({report.summary.translation.fail}건)
                            </summary>
                            <div className="mt-2 max-h-80 overflow-auto rounded border border-red-100">
                                <table className="w-full text-left text-xs">
                                    <thead className="sticky top-0 bg-red-50">
                                        <tr>
                                            <th className="p-2">셀</th>
                                            <th className="p-2">기대</th>
                                            <th className="p-2">페이지 실제</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.translations
                                            .filter((t) => t.status === "fail")
                                            .map((t) => (
                                                <tr key={t.cell} className="border-t border-red-50">
                                                    <td className="p-2 align-top font-mono">{t.cell}</td>
                                                    <td className="p-2 align-top">{t.expected}</td>
                                                    <td className="p-2 align-top text-red-900">
                                                        {t.actual ?? "(미확인)"}
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        </details>
                    ) : null}

                    {markdown ? (
                        <details className="mt-2">
                            <summary className="cursor-pointer text-sm font-medium text-zinc-700">
                                상세 Markdown 리포트
                            </summary>
                            <pre className="mt-2 max-h-96 overflow-auto rounded bg-zinc-100 p-3 text-xs whitespace-pre-wrap">
                                {markdown}
                            </pre>
                        </details>
                    ) : null}
                </section>
            ) : null}
        </main>
    );
}
