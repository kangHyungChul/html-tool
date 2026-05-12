"use client";

/**
 * Business Area HTML 생성기 메인 화면.
 *
 * 데이터 흐름(요약):
 * 1) 공통 헤드 조각과 mapped 본문을 각각 불러온다. (서버 업로드 없음)
 * 2) 사용자가 .xlsx를 선택하면 parseExcel → 추출 후, 빈 셀은 JSON `initialValue`로 보완한다.
 * 3) CellValueMap이 바뀔 때마다 mapped 본문만 generateHtmlByCellPlaceholders로 치환한다.
 * 4) 좌측 “HTML 코드”·다운로드에는 치환된 본문만; 미리보기 iframe에는 공통 헤드+본문을 붙인 뒤,
 *    `/content/dam/` 만 https://www.lg.com 기준 절대 URL로 바꿔 에셋을 불러온다(코드·다운로드에는 미적용).
 * 5) 미리보기는 전체화면(Fullscreen API)으로 확대해 볼 수 있다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import cellMapConfig from "@/features/html-generator/constants/businessAreaCellMap.config.json";
import { buildCellValueMapFromInitialValues, mergeExtractedWithInitialFallback } from "@/features/html-generator/lib/buildCellValueMapFromConfig";
import { buildMultilineByCellFromConfig } from "@/features/html-generator/lib/buildMultilineByCellFromConfig";
import { downloadHtml } from "@/features/html-generator/lib/downloadHtml";
import { extractBusinessAreaCellData } from "@/features/html-generator/lib/extractBusinessAreaCellData";
import { generateHtmlByCellPlaceholders } from "@/features/html-generator/lib/generateHtmlByCellPlaceholders";
import { loadBusinessAreaTemplateParts } from "@/features/html-generator/lib/loadBusinessAreaTemplateHtml";
import { parseExcel } from "@/features/html-generator/lib/parseExcel";
import {
    attachPreviewTabActiveObserver,
    clickPreviewTabByPanelId,
    PREVIEW_PANEL_ID_BY_SECTION_KEY,
    sectionKeyFromPreviewPanelId,
} from "@/features/html-generator/lib/businessAreaPreviewTabBridge";
import { rewriteLgDamPathsForPreview } from "@/features/html-generator/lib/rewriteLgDamPathsForPreview";
import type { BusinessAreaCellMapConfig, CellValueMap } from "@/features/html-generator/types/cellMapConfig.types";

/** JSON을 타입 안전하게 쓰기 위한 단일 캐스팅 지점 */
const CONFIG = cellMapConfig as BusinessAreaCellMapConfig;

/**
 * 샘플 카피덱 엑셀 경로(`public/example/business_area_template.xlsx`).
 * 빌드 후 브라우저에서는 동일 경로로 정적 제공되며, 서버 업로드가 아니라 GET으로만 받는다.
 */
const EXAMPLE_XLSX_PUBLIC_PATH = "/example/business_area_template.xlsx";
/** 저장 대화상자에 제안할 파일명(브라우저마다 download 속성 지원이 다를 수 있음) */
const EXAMPLE_XLSX_DOWNLOAD_NAME = "business_area_template.xlsx";

type LeftTab = "code" | "preview";

/** 우측 편집 섹션과 미리보기 탭을 맞출 때 사용하는 기본 섹션 키(설정의 첫 항목·매핑 있음 우선) */
function getDefaultActiveSectionKey(config: BusinessAreaCellMapConfig): string {
    const first = config.sections[0]?.key ?? "ecoSolution";
    const mapped = config.sections.find((s) => PREVIEW_PANEL_ID_BY_SECTION_KEY[s.key]);
    return mapped?.key ?? first;
}

export default function HomePage() {
    /** 공통 헤드(링크·ST0002 스타일). 미리보기에만 사용; 코드/다운로드에는 포함하지 않음 */
    const [commonHeadHtml, setCommonHeadHtml] = useState<string | null>(null);
    /** `{D6}` 등 placeholder가 있는 mapped 본문 원본. 치환은 이 문자열만 대상으로 한다 */
    const [mappedBodyTemplate, setMappedBodyTemplate] = useState<string | null>(null);
    /** 템플릿 fetch 실패 시 메시지 */
    const [templateError, setTemplateError] = useState<string | null>(null);
    /** 셀 주소 → 값. 최초에는 JSON `initialValue`로 채우고, 엑셀 업로드 시 병합·교체한다 */
    const [cellValueMap, setCellValueMap] = useState<CellValueMap>(() =>
        buildCellValueMapFromInitialValues(CONFIG),
    );
    /** 엑셀 처리 등 사용자 알림 */
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    /** 좌측 미리보기 래퍼(ref). 전체화면 대상으로 이 요소만 확장한다 */
    const previewHostRef = useRef<HTMLDivElement>(null);
    /** document.fullscreenElement가 preview 래퍼인지 여부(툴바 라벨·레이아웃용) */
    const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
    /** 좌측 탭: 소스 코드 vs iframe 미리보기 */
    const [leftTab, setLeftTab] = useState<LeftTab>("preview");
    /** 우측「셀 값 편집」에서 선택 중인 Business Area 섹션(Eco / Vehicle …). 미리보기 iframe 탭과 양방향 동기화한다. */
    const [activeSectionKey, setActiveSectionKey] = useState<string>(() => getDefaultActiveSectionKey(CONFIG));
    /** `activeSectionKey` 최신값 — iframe onLoad·MutationObserver 콜백에서 클로저 없이 읽기 위함 */
    const activeSectionKeyRef = useRef(activeSectionKey);
    activeSectionKeyRef.current = activeSectionKey;

    /** 미리보기 iframe DOM — 탭 클릭 시뮬레이션·옵저버 부착에 사용 */
    const previewIframeRef = useRef<HTMLIFrameElement>(null);
    /** srcdoc 갱신 등으로 iframe이 바뀔 때 이전 MutationObserver 해제 */
    const previewTabObserverCleanupRef = useRef<(() => void) | null>(null);

    const multilineByCell = useMemo(() => buildMultilineByCellFromConfig(CONFIG), []);

    /** 현재 편집 중인 섹션 한 덩어리(필드 목록). 탭으로 하나만 펼쳐서 보여준다. */
    const activeSection = useMemo(
        () => CONFIG.sections.find((s) => s.key === activeSectionKey) ?? CONFIG.sections[0],
        [activeSectionKey],
    );

    /**
     * 우측에서 섹션 탭을 눌렀을 때: 편집 섹션을 바꾸고, 좌측은 미리보기로 전환한 뒤
     * iframe 안의 **실제 탭**에 클릭을 보내 템플릿 내장 스크립트가 패널 전환을 하게 한다(mapped HTML 비수정).
     */
    const selectEditorSection = useCallback((sectionKey: string) => {
        setActiveSectionKey(sectionKey);
        setLeftTab("preview");
        const panelId = PREVIEW_PANEL_ID_BY_SECTION_KEY[sectionKey];
        if (!panelId) {
            return;
        }
        window.setTimeout(() => {
            const iframe = previewIframeRef.current;
            if (iframe) {
                clickPreviewTabByPanelId(iframe, panelId);
            }
        }, 80);
    }, []);

    /**
     * iframe 문서가 로드될 때마다: 템플릿 스크립트 초기화 이후를 가정해 짧게 지연 후 현재 섹션에 맞는 탭 클릭,
     * 그리고 탭 활성 표시 변화를 감시해 우측 섹션 선택과 동기화한다.
     */
    const handlePreviewIframeLoad = useCallback(() => {
        previewTabObserverCleanupRef.current?.();
        previewTabObserverCleanupRef.current = null;

        const iframe = previewIframeRef.current;
        if (!iframe) {
            return;
        }

        window.setTimeout(() => {
            const panelId = PREVIEW_PANEL_ID_BY_SECTION_KEY[activeSectionKeyRef.current];
            if (panelId) {
                clickPreviewTabByPanelId(iframe, panelId);
            }

            previewTabObserverCleanupRef.current = attachPreviewTabActiveObserver(iframe, (pid) => {
                const key = sectionKeyFromPreviewPanelId(pid);
                // 미리보기에서 탭만 바꾼 경우: 우측 섹션 탭을 같은 솔루션으로 맞춘다(이미 같으면 상태 갱신 생략)
                if (key && key !== activeSectionKeyRef.current) {
                    setActiveSectionKey(key);
                }
            });
        }, 320);
    }, []);

    /** 페이지 이탈 시 옵저버 정리 */
    useEffect(() => {
        return () => {
            previewTabObserverCleanupRef.current?.();
            previewTabObserverCleanupRef.current = null;
        };
    }, []);

    /** 앱 마운트 시 템플릿만 로드. 엑셀은 사용자가 업로드할 때까지 비워 둔다(MVP). */
    useEffect(() => {
        let cancelled = false;

        async function loadTemplate() {
            try {
                const { commonHead, mappedBody } = await loadBusinessAreaTemplateParts();
                if (!cancelled) {
                    setCommonHeadHtml(commonHead);
                    setMappedBodyTemplate(mappedBody);
                    setTemplateError(null);
                }
            } catch (e) {
                if (!cancelled) {
                    setTemplateError(e instanceof Error ? e.message : "알 수 없는 오류");
                }
            }
        }

        void loadTemplate();

        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * mapped 본문만 placeholder 치환한 결과.
     * HTML 코드 탭·다운로드 파일에는 이 문자열만 사용한다(공통 헤드 제외).
     */
    const generatedBodyHtml = useMemo(() => {
        if (!mappedBodyTemplate) {
            return "";
        }

        return generateHtmlByCellPlaceholders({
            template: mappedBodyTemplate,
            data: cellValueMap,
            multilineByCell,
        });
    }, [mappedBodyTemplate, cellValueMap, multilineByCell]);

    /**
     * iframe 미리보기용: 공통 헤드 + 본문을 이은 뒤, **미리보기에서만**
     * `/content/dam/...` → `https://www.lg.com/content/dam/...` 로 바꾼다.
     * (HTML 코드·다운로드는 `generatedBodyHtml` 원문을 그대로 쓴다.)
     */
    const previewSrcDoc = useMemo(() => {
        const head = commonHeadHtml ?? "";
        const body = generatedBodyHtml ?? "";

        if (!head.trim() && !body) {
            return "";
        }

        const combined = head.trim() ? `${head.trimEnd()}\n${body}` : body;

        return rewriteLgDamPathsForPreview(combined);
    }, [commonHeadHtml, generatedBodyHtml]);

    /**
     * 엑셀 파일 선택 시: 브라우저 내에서만 파싱하고 CellValueMap을 통째로 교체한다.
     * (기존 수동 편집 내용은 새 파일 기준으로 덮어쓴다)
     */
    const handleExcelSelected = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = "";

            if (!file) {
                return;
            }

            setStatusMessage(null);

            try {
                const workbook = await parseExcel(file);
                const extracted = extractBusinessAreaCellData(workbook);
                const nextMap = mergeExtractedWithInitialFallback(extracted, CONFIG);
                setCellValueMap(nextMap);
                setStatusMessage(`엑셀을 읽었습니다: ${file.name}`);
            } catch (e) {
                const message = e instanceof Error ? e.message : "엑셀을 읽는 중 오류가 발생했습니다.";
                setStatusMessage(message);
            }
        },
        [],
    );

    /** 우측 필드에서 특정 셀 값만 갱신 */
    const handleCellChange = useCallback((cell: string, value: string) => {
        setCellValueMap((prev) => ({
            ...prev,
            [cell]: value,
        }));
    }, []);

    const handleDownload = useCallback(() => {
        if (!generatedBodyHtml) {
            setStatusMessage("다운로드할 HTML이 없습니다. 템플릿 로딩을 확인해 주세요.");
            return;
        }

        downloadHtml({
            html: generatedBodyHtml,
            fileName: "business-area.generated.html",
        });
    }, [generatedBodyHtml]);

    /**
     * 브라우저 전체화면 API: 미리보기 컨테이너만 전체 화면으로 올려 iframe이 화면을 채우도록 한다.
     * - 표준: requestFullscreen / exitFullscreen
     * - 구형 Safari 등: webkit 접두(실패 시 메시지)
     */
    const enterPreviewFullscreen = useCallback(async () => {
        const el = previewHostRef.current;
        if (!el) {
            return;
        }

        const webkitEl = el as HTMLElement & { webkitRequestFullscreen?: () => void };

        try {
            if (el.requestFullscreen) {
                await el.requestFullscreen();
            } else if (typeof webkitEl.webkitRequestFullscreen === "function") {
                webkitEl.webkitRequestFullscreen();
            } else {
                setStatusMessage("이 브라우저에서는 전체화면을 지원하지 않습니다.");
            }
        } catch {
            setStatusMessage("전체화면을 시작할 수 없습니다.");
        }
    }, []);

    const exitPreviewFullscreen = useCallback(async () => {
        const doc = document as Document & { webkitExitFullscreen?: () => void };

        try {
            if (document.fullscreenElement && document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (typeof doc.webkitExitFullscreen === "function") {
                doc.webkitExitFullscreen();
            }
        } catch {
            setStatusMessage("전체화면을 종료할 수 없습니다.");
        }
    }, []);

    /** 전체화면 진입/해제 시 툴바 문구 동기화(ESC로 나와도 반영) */
    useEffect(() => {
        const sync = () => {
            const host = previewHostRef.current;
            setIsPreviewFullscreen(!!host && document.fullscreenElement === host);
        };

        document.addEventListener("fullscreenchange", sync);
        return () => document.removeEventListener("fullscreenchange", sync);
    }, []);

    /** 미리보기 탭을 벗어나면 전체화면 자동 해제 */
    useEffect(() => {
        if (leftTab !== "preview") {
            const host = previewHostRef.current;
            if (host && document.fullscreenElement === host) {
                void exitPreviewFullscreen();
            }
        }
    }, [leftTab, exitPreviewFullscreen]);

    const isReady =
        commonHeadHtml !== null && mappedBodyTemplate !== null && templateError === null;

    return (
        <main className="mx-auto flex min-h-screen max-w-[2000px] flex-col gap-4 p-4 md:p-6">
            <header className="border-b border-zinc-200 pb-4">
                <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
                    Why LG 번역 적용 툴
                </h1>
                <p className="mt-1 text-sm text-zinc-600">
                    지정 포맷의 .xlsx를 업로드하면 첫 번째 시트에서 값을 읽어 같은 placeholder에 반영합니다.<br/>시트 범위·탭명 행이 카피덱과 맞지 않으면 오류로 안내합니다.
                </p>
            </header>

            {/* 샘플 엑셀: 저장소의 public/example 에 파일이 있어야 링크가 200으로 동작한다 */}
            <section
                className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 shadow-sm"
                aria-labelledby="example-xlsx-heading"
            >
                <h2 id="example-xlsx-heading" className="text-sm font-semibold text-zinc-900">
                    엑셀 템플릿 다운로드
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                    카피덱 양식 샘플(<code className="rounded bg-zinc-200 px-1 py-0.5 text-xs">business_area_template.xlsx</code>)을
                    받은 뒤, 첫 번째 시트를 채워 위의「엑셀 업로드」에 사용할 수 있습니다.
                </p>
                <div className="mt-3">
                    <a
                        href={EXAMPLE_XLSX_PUBLIC_PATH}
                        download={EXAMPLE_XLSX_DOWNLOAD_NAME}
                        className="inline-flex items-center rounded-lg border border-zinc-400 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50"
                    >
                        템플릿 .xlsx 받기
                    </a>
                </div>
            </section>

            <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-zinc-800">
                    <span>엑셀 업로드 (.xlsx)</span>
                    <input
                        type="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        className="sr-only"
                        onChange={handleExcelSelected}
                    />
                </label>

                <button
                    type="button"
                    className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleDownload}
                    disabled={!isReady || !generatedBodyHtml}
                >
                    HTML 다운로드
                </button>

                {statusMessage ? (
                    <p className="text-sm text-zinc-700" role="status">
                        {statusMessage}
                    </p>
                ) : null}
            </div>

            {templateError ? (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    템플릿 로드 오류: {templateError}
                </p>
            ) : null}

            {!isReady && !templateError ? (
                <p className="text-sm text-zinc-600">템플릿 HTML을 불러오는 중입니다…</p>
            ) : null}

            <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:items-start">
                {/* 좌측: HTML 코드 / 미리보기 */}
                <section className="flex min-h-[70vh] flex-col rounded-xl border border-zinc-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 p-3">
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                                    leftTab === "code"
                                        ? "bg-zinc-900 text-white"
                                        : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
                                }`}
                                onClick={() => setLeftTab("code")}
                            >
                                HTML 코드
                            </button>
                            <button
                                type="button"
                                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                                    leftTab === "preview"
                                        ? "bg-zinc-900 text-white"
                                        : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
                                }`}
                                onClick={() => setLeftTab("preview")}
                            >
                                미리보기
                            </button>
                        </div>
                        {/* 미리보기 탭일 때만: 탭과 같은 줄 오른쪽에서 전체화면 진입(종료는 전체화면 안에서만 표시) */}
                        {leftTab === "preview" && !isPreviewFullscreen ? (
                            <button
                                type="button"
                                className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => void enterPreviewFullscreen()}
                                disabled={!previewSrcDoc}
                                title="미리보기 영역만 화면 전체로 확대합니다. ESC로도 종료할 수 있습니다."
                                aria-label="미리보기 전체화면으로 보기"
                            >
                                전체화면
                            </button>
                        ) : null}
                    </div>

                    <div className="min-h-0 flex-1 p-3">
                        {leftTab === "code" ? (
                            <textarea
                                readOnly
                                value={generatedBodyHtml}
                                spellCheck={false}
                                className="h-[min(70vh,800px)] w-full resize-y rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-900"
                                aria-label="생성된 HTML 소스"
                            />
                        ) : (
                            <div
                                ref={previewHostRef}
                                className="relative flex min-h-[min(70vh,800px)] flex-col rounded-md border border-zinc-200 bg-zinc-50 p-2 [&:fullscreen]:min-h-screen [&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:fullscreen]:bg-white [&:fullscreen]:p-0"
                            >
                                {/* 전체화면 시에는 탭 줄이 보이지 않으므로, 같은 래퍼 안에 종료 버튼을 둔다 */}
                                {isPreviewFullscreen ? (
                                    <div className="absolute left-0 right-0 top-0 z-10 flex justify-end border-b border-zinc-200 bg-white/95 p-2 backdrop-blur-sm">
                                        <button
                                            type="button"
                                            className="rounded-md bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-300"
                                            onClick={() => void exitPreviewFullscreen()}
                                            title="ESC로도 종료할 수 있습니다."
                                            aria-label="미리보기 전체화면 종료"
                                        >
                                            전체화면 종료
                                        </button>
                                    </div>
                                ) : null}
                                <iframe
                                    ref={previewIframeRef}
                                    title="HTML 미리보기"
                                    className={`min-h-0 w-full flex-1 rounded-md border border-zinc-200 bg-white ${isPreviewFullscreen ? "pt-12" : ""}`}
                                    // 조각 HTML이므로 외부 CSS 링크 등이 동작하도록 sandbox는 걸지 않는다(MVP).
                                    srcDoc={previewSrcDoc}
                                    onLoad={handlePreviewIframeLoad}
                                />
                            </div>
                        )}
                    </div>
                </section>

                {/* 우측: JSON 기반 편집 패널 */}
                <aside className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-sm lg:sticky lg:top-4">
                    <h2 className="mb-3 text-sm font-semibold text-zinc-800">셀 값 편집</h2>
                    {/* 솔루션별 필드: 상단 탭으로 섹션 전환 — 선택 시 좌측 미리보기의 동일 솔루션 탭도 활성화된다. */}
                    <div
                        className="mb-4 flex flex-wrap gap-1 border-b border-zinc-200 pb-3"
                        role="tablist"
                        aria-label="Business Area 솔루션별 편집 탭"
                    >
                        {CONFIG.sections.map((section) => {
                            const selected = section.key === activeSectionKey;
                            return (
                                <button
                                    key={section.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium md:text-sm ${
                                        selected
                                            ? "bg-zinc-900 text-white"
                                            : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
                                    }`}
                                    onClick={() => selectEditorSection(section.key)}
                                >
                                    {section.label}
                                </button>
                            );
                        })}
                    </div>

                    {activeSection ? (
                        <div role="tabpanel" aria-label={`${activeSection.label} 필드`}>
                            <ul className="flex flex-col gap-3">
                                {activeSection.fields.map((field) => (
                                    <li key={field.key} className="flex flex-col gap-1">
                                        <label className="text-xs font-medium text-zinc-700">
                                            {field.label}
                                            {field.required ? (
                                                <span className="ml-0.5 text-red-500" title="필수">
                                                    *
                                                </span>
                                            ) : null}
                                            <span className="ml-1 font-normal text-zinc-400">({field.cell})</span>
                                        </label>
                                        {field.inputType === "textarea" ? (
                                            <textarea
                                                className="min-h-[72px] w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                                value={cellValueMap[field.cell] ?? ""}
                                                onChange={(e) => handleCellChange(field.cell, e.target.value)}
                                            />
                                        ) : (
                                            <input
                                                type="text"
                                                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                                value={cellValueMap[field.cell] ?? ""}
                                                onChange={(e) => handleCellChange(field.cell, e.target.value)}
                                            />
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </aside>
            </div>
        </main>
    );
}
