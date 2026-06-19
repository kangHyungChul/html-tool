"use client";

/**
 * Business Area QA 설정 UI.
 * - QA 실행 중 폼 잠금 + 중단 버튼 + 진행 상황 표시
 * - POST /api/qa/run NDJSON 스트림 수신
 */

import localeMapJson from "@/features/html-generator/constants/locale-map.json";
import { buildQaTargetPageUrl, getDefaultBaselineUrl } from "@/qa/lib/qaPageUrls";
import type {
    BaselineMappingPhaseResult,
    BusinessAreaQaReport,
    LinkLocalePhaseResult,
    LinkNavigationPhaseResult,
    QaProgressEvent,
    QaProgressPhase,
    TranslationPhaseResult,
} from "@/qa/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";

const LOCALE_KEYS = Object.keys(localeMapJson as Record<string, unknown>).filter((k) => k !== "global");

/** UI에 표시할 진행 단계 정의 */
const PROGRESS_STEPS: { phase: QaProgressPhase; label: string }[] = [
    { phase: "excel", label: "엑셀 파싱" },
    { phase: "browser", label: "브라우저 시작" },
    { phase: "baseline-load", label: "비교군 페이지 로드" },
    { phase: "baseline-locate", label: "as-is 위치 매핑" },
    { phase: "page-load", label: "검증 대상 페이지 로드" },
    { phase: "business-area", label: "Business Area 탐색" },
    { phase: "translation", label: "번역 검증 (동일 구조 위치)" },
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
    | { type: "phase-result"; result: BaselineMappingPhaseResult | TranslationPhaseResult | LinkLocalePhaseResult | LinkNavigationPhaseResult }
    | { type: "complete"; report: BusinessAreaQaReport; markdown: string }
    | { type: "cancelled" }
    | { type: "error"; message: string };

function truncate(text: string, max = 48): string {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}…`;
}

function itemStatusClass(status: string): string {
    if (status === "pass" || status === "mapped") {
        return "text-green-800 bg-green-50";
    }
    if (status === "fail" || status === "unresolved") {
        return "text-red-800 bg-red-50";
    }
    if (status === "warn") {
        return "text-amber-800 bg-amber-50";
    }
    return "text-zinc-600 bg-zinc-100";
}

export default function QaPage() {
    const [baselineUrl, setBaselineUrl] = useState(() => getDefaultBaselineUrl());
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
    const [baselineMapping, setBaselineMapping] = useState<BaselineMappingPhaseResult | null>(null);
    const [translationResult, setTranslationResult] = useState<TranslationPhaseResult | null>(null);
    const [linkLocaleResult, setLinkLocaleResult] = useState<LinkLocalePhaseResult | null>(null);
    const [linkNavResult, setLinkNavResult] = useState<LinkNavigationPhaseResult | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
    /** 진행 중 fetch·스트림이 속한 실행 세션 — 중단·재실행 시 이전 작업 무효화 */
    const runSessionRef = useRef(0);
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

    const handleCancel = useCallback((e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        runSessionRef.current += 1;
        abortRef.current?.abort();
        readerRef.current?.cancel().catch(() => undefined);
        abortRef.current = null;
        readerRef.current = null;
        setCancelled(true);
        setRunning(false);
        setProgress(null);
    }, []);

    const handleSubmit = useCallback(
        async (e: FormEvent) => {
            e.preventDefault();

            /** 이전 실행(또는 중단 직후 잔여 fetch) 무효화 */
            runSessionRef.current += 1;
            const sessionId = runSessionRef.current;
            abortRef.current?.abort();
            readerRef.current?.cancel().catch(() => undefined);

            const isActive = () => sessionId === runSessionRef.current;

            setError(null);
            setCancelled(false);
            setReport(null);
            setMarkdown(null);
            setProgress(null);
            setBaselineMapping(null);
            setTranslationResult(null);
            setLinkLocaleResult(null);
            setLinkNavResult(null);

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

                if (!isActive()) {
                    return;
                }

                if (!res.ok || !res.body) {
                    setError(`QA 요청 실패 (HTTP ${res.status})`);
                    return;
                }

                const reader = res.body.getReader();
                readerRef.current = reader;
                const decoder = new TextDecoder();
                let buffer = "";

                try {
                    while (isActive()) {
                        const { done, value } = await reader.read();
                        if (done) {
                            break;
                        }

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop() ?? "";

                        for (const line of lines) {
                            if (!isActive()) {
                                break;
                            }
                            if (!line.trim()) {
                                continue;
                            }

                            const data = JSON.parse(line) as StreamLine;

                            if (data.type === "progress") {
                                setProgress(data.event);
                            } else if (data.type === "phase-result") {
                                if (data.result.phase === "baseline-locate") {
                                    setBaselineMapping(data.result);
                                } else if (data.result.phase === "translation") {
                                    setTranslationResult(data.result);
                                } else if (data.result.phase === "link-locale") {
                                    setLinkLocaleResult(data.result);
                                } else if (data.result.phase === "link-navigation") {
                                    setLinkNavResult(data.result);
                                }
                            } else if (data.type === "complete") {
                                setReport(data.report);
                                setMarkdown(data.markdown);
                            } else if (data.type === "cancelled") {
                                setCancelled(true);
                                setProgress(null);
                            } else if (data.type === "error") {
                                setError(data.message);
                            }
                        }
                    }
                } finally {
                    if (readerRef.current === reader) {
                        readerRef.current = null;
                    }
                    try {
                        reader.releaseLock();
                    } catch {
                        /* abort 후 lock 해제 실패 무시 */
                    }
                }
            } catch (err) {
                if (!isActive()) {
                    return;
                }
                if (err instanceof Error && err.name === "AbortError") {
                    setCancelled(true);
                    setProgress(null);
                } else if (!controller.signal.aborted) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "QA 요청 실패 — 로컬에서 `npm run dev` 가 실행 중인지 확인해 주세요.",
                    );
                }
            } finally {
                if (isActive()) {
                    abortRef.current = null;
                    readerRef.current = null;
                    setRunning(false);
                }
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
                    비교군(global) 페이지에서 global 엑셀 텍스트 위치를 잡고, 검증 대상(locale) 페이지
                    동일 위치에 locale 엑셀 번역이 들어갔는지 확인합니다.
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
                    ) : null}
                </div>
            </form>

            {running ? (
                <button
                    type="button"
                    onClick={handleCancel}
                    className="inline-flex items-center justify-center rounded-md border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800 hover:bg-red-100"
                >
                    중단
                </button>
            ) : null}

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
                                    {step.phase === "baseline-locate" &&
                                    progress?.phase === "baseline-locate" &&
                                    progress.total
                                        ? ` (${progress.current ?? 0}/${progress.total})`
                                        : null}
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

            {baselineMapping ? (
                <section className="rounded-lg border border-violet-200 bg-violet-50/50 p-4">
                    <h2 className="text-sm font-semibold text-violet-900">
                        1. as-is 위치 매핑 (템플릿 구조 + global 엑셀)
                    </h2>
                    <p className="mt-1 text-xs text-violet-800">
                        매핑 {baselineMapping.summary.mapped} · 실패 {baselineMapping.summary.unresolved} ·
                        skip {baselineMapping.summary.skipped}
                    </p>
                    <div className="mt-3 max-h-72 overflow-auto rounded border border-violet-100 bg-white">
                        <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-violet-100">
                                <tr>
                                    <th className="p-2">셀</th>
                                    <th className="p-2">global 텍스트</th>
                                    <th className="p-2">상태</th>
                                    <th className="p-2">방식</th>
                                    <th className="p-2">DOM 셀렉터</th>
                                </tr>
                            </thead>
                            <tbody>
                                {baselineMapping.rows
                                    .filter((r) => r.status !== "skipped")
                                    .map((row) => (
                                        <tr key={row.cell} className="border-t border-violet-50">
                                            <td className="p-2 align-top font-mono">{row.cell}</td>
                                            <td className="p-2 align-top" title={row.baselineText}>
                                                {truncate(row.baselineText)}
                                            </td>
                                            <td className="p-2 align-top">
                                                <span
                                                    className={`rounded px-1.5 py-0.5 ${itemStatusClass(row.status)}`}
                                                >
                                                    {row.status}
                                                </span>
                                            </td>
                                            <td className="p-2 align-top text-zinc-600">
                                                {row.readFrom
                                                    ? `${row.source ?? "mapped"} (${row.readFrom})`
                                                    : row.source ?? (row.reason ? truncate(row.reason, 32) : "—")}
                                            </td>
                                            <td
                                                className="p-2 align-top font-mono text-[10px] text-zinc-500"
                                                title={row.relativeSelector}
                                            >
                                                {row.relativeSelector
                                                    ? truncate(row.relativeSelector, 56)
                                                    : "—"}
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : null}

            {translationResult ? (
                <section className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
                    <h2 className="text-sm font-semibold text-emerald-900">
                        2. 번역 검증 (동일 구조 위치 ↔ locale 엑셀)
                    </h2>
                    <p className="mt-1 text-xs text-emerald-800">
                        PASS {translationResult.summary.pass} · FAIL {translationResult.summary.fail} ·
                        SKIP {translationResult.summary.skip}
                    </p>
                    <div className="mt-3 max-h-72 overflow-auto rounded border border-emerald-100 bg-white">
                        <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-emerald-100">
                                <tr>
                                    <th className="p-2">셀</th>
                                    <th className="p-2">locale 기대</th>
                                    <th className="p-2">페이지 실제</th>
                                    <th className="p-2">결과</th>
                                </tr>
                            </thead>
                            <tbody>
                                {translationResult.results
                                    .filter((t) => t.status !== "skip")
                                    .map((t) => (
                                        <tr key={t.cell} className="border-t border-emerald-50">
                                            <td className="p-2 align-top font-mono">{t.cell}</td>
                                            <td className="p-2 align-top" title={t.expected}>
                                                {truncate(t.expected)}
                                            </td>
                                            <td
                                                className={`p-2 align-top ${t.status === "fail" ? "text-red-900" : ""}`}
                                                title={t.actual}
                                            >
                                                {t.status === "fail"
                                                    ? truncate(t.actual ?? t.detail ?? "(미확인)")
                                                    : "—"}
                                            </td>
                                            <td className="p-2 align-top">
                                                <span
                                                    className={`rounded px-1.5 py-0.5 ${itemStatusClass(t.status)}`}
                                                >
                                                    {t.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : null}

            {linkLocaleResult ? (
                <section className="rounded-lg border border-sky-200 bg-sky-50/50 p-4">
                    <h2 className="text-sm font-semibold text-sky-900">3. 링크 경로 검증 (global/locale)</h2>
                    <p className="mt-1 text-xs text-sky-800">
                        PASS {linkLocaleResult.summary.pass} · FAIL {linkLocaleResult.summary.fail} ·
                        SKIP {linkLocaleResult.summary.skip}
                    </p>
                    <div className="mt-3 max-h-60 overflow-auto rounded border border-sky-100 bg-white">
                        <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-sky-100">
                                <tr>
                                    <th className="p-2">href</th>
                                    <th className="p-2">결과</th>
                                    <th className="p-2">비고</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linkLocaleResult.results
                                    .filter((r) => r.status !== "skip")
                                    .map((r, idx) => (
                                        <tr key={`${r.href}-${idx}`} className="border-t border-sky-50">
                                            <td className="p-2 align-top font-mono" title={r.href}>
                                                {truncate(r.href, 40)}
                                            </td>
                                            <td className="p-2 align-top">
                                                <span
                                                    className={`rounded px-1.5 py-0.5 ${itemStatusClass(r.status)}`}
                                                >
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="p-2 align-top text-zinc-600">
                                                {r.detail ? truncate(r.detail, 36) : "—"}
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : null}

            {linkNavResult ? (
                <section className="rounded-lg border border-orange-200 bg-orange-50/50 p-4">
                    <h2 className="text-sm font-semibold text-orange-900">4. 링크 클릭·404 검증</h2>
                    <p className="mt-1 text-xs text-orange-800">
                        PASS {linkNavResult.summary.pass} · FAIL {linkNavResult.summary.fail} ·
                        SKIP {linkNavResult.summary.skip}
                    </p>
                    <div className="mt-3 max-h-60 overflow-auto rounded border border-orange-100 bg-white">
                        <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-orange-100">
                                <tr>
                                    <th className="p-2">href</th>
                                    <th className="p-2">결과</th>
                                    <th className="p-2">비고</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linkNavResult.results
                                    .filter((r) => r.status !== "skip")
                                    .map((r, idx) => (
                                        <tr key={`${r.href}-${idx}`} className="border-t border-orange-50">
                                            <td className="p-2 align-top font-mono" title={r.href}>
                                                {truncate(r.href, 40)}
                                            </td>
                                            <td className="p-2 align-top">
                                                <span
                                                    className={`rounded px-1.5 py-0.5 ${itemStatusClass(r.status)}`}
                                                >
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="p-2 align-top text-zinc-600">
                                                {r.detail ? truncate(r.detail, 36) : "—"}
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
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
