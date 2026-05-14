"use client";

/**
 * Business Area HTML 생성기 메인 화면.
 *
 * 데이터 흐름(요약):
 * 1) 공통 헤드 조각과 mapped 본문을 각각 불러온다. (서버 업로드 없음)
 * 2) 워크 탭: 기본은 `Default` 하나(JSON `initialValue`). 엑셀 업로드 시 양식에 맞는 시트마다 탭을 만들고 Default는 제거한다.
 * 3) 활성 워크 탭의 CellValueMap으로 mapped 본문만 generateHtmlByCellPlaceholders로 치환한다.
 * 3b) 본문 안 `href` 값 중 `https://www.lg.com/global/…` 는 시트에 대응하는 `locale-map.json` 키 경로로 바꾼다(예: `…/uk/…`).
 * 4) 좌측 “HTML 코드”·다운로드에는 위까지 적용된 본문만; 미리보기 iframe에는 완전 문서로 감싼 뒤
 *    활성 워크 탭(시트명)에 맞는 `lang`·`data-countrycode`를 루트 `<html>`에 넣고,
 *    공통 헤드 조각의 `href` 에도 동일 LG URL 경로 치환을 적용한 뒤,
 *    `/content/dam/` 만 https://www.lg.com 기준 절대 URL로 바꾼다(코드·다운로드에는 DAM 치환 미적용).
 * 5) 미리보기는 전체화면(Fullscreen API)으로 확대해 볼 수 있다.
 * 6) 미리보기 탭에서 PC/모바일 뷰 전환: 모바일은 iframe 래퍼 너비를 약 376px로 두어 좁은 화면을 시뮬레이션한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import placeholderMapJson from "@/features/html-generator/constants/business-area-template.placeholder-map.config.json";
import { buildCellValueMapFromInitialValues, mergeExtractedWithInitialFallback } from "@/features/html-generator/lib/buildCellValueMapFromConfig";
import { buildMultilineByCellFromConfig } from "@/features/html-generator/lib/buildMultilineByCellFromConfig";
import { downloadHtml } from "@/features/html-generator/lib/downloadHtml";
import { listBusinessAreaSheetsFromWorkbook } from "@/features/html-generator/lib/extractBusinessAreaCellData";
import { generateHtmlByCellPlaceholders } from "@/features/html-generator/lib/generateHtmlByCellPlaceholders";
import { loadBusinessAreaTemplateParts } from "@/features/html-generator/lib/loadBusinessAreaTemplateHtml";
import { adaptPlaceholderMapToCellMap } from "@/features/html-generator/lib/placeholderMapToBusinessAreaCellMap";
import { parseExcel } from "@/features/html-generator/lib/parseExcel";
import {
    attachPreviewTabActiveObserver,
    clickPreviewTabByPanelId,
    PREVIEW_PANEL_ID_BY_SECTION_KEY,
    sectionKeyFromPreviewPanelId,
} from "@/features/html-generator/lib/businessAreaPreviewTabBridge";
import { rewriteLgDamPathsForPreview } from "@/features/html-generator/lib/rewriteLgDamPathsForPreview";
import { rewriteLgComGlobalPathToLocale } from "@/features/html-generator/lib/rewriteLgComGlobalPathToLocale";
import {
    getPreviewLocaleAttrsForWorkTabLabel,
    resolveLocaleMapKeyForWorkTab,
} from "@/features/html-generator/lib/lgLocaleFromWorkTabLabel";
import { escapeHtml } from "@/features/html-generator/lib/escapeHtml";
import type {
    BusinessAreaCellMapConfig,
    BusinessAreaSectionConfig,
    CellValueMap,
    PlaceholderMapConfig,
} from "@/features/html-generator/types/cellMapConfig.types";

/** placeholder-map JSON → sections·excel 메타가 채워진 런타임 설정 */
const CONFIG = adaptPlaceholderMapToCellMap(placeholderMapJson as PlaceholderMapConfig).cellMap;

/**
 * 샘플 카피덱 엑셀 경로(`public/example/business_area_template.xlsx`).
 * 빌드 후 브라우저에서는 동일 경로로 정적 제공되며, 서버 업로드가 아니라 GET으로만 받는다.
 */
const EXAMPLE_XLSX_PUBLIC_PATH = "/example/business_area_template.xlsx";
/** 저장 대화상자에 제안할 파일명(브라우저마다 download 속성 지원이 다를 수 있음) */
const EXAMPLE_XLSX_DOWNLOAD_NAME = "business_area_template.xlsx";

/** JSON 초기값 전용 워크 탭 ID(엑셀 업로드 전 단일 탭) */
const DEFAULT_WORK_TAB_ID = "work-tab-default";

type LeftTab = "code" | "preview";

/** 시트/기본값 단위로 HTML·편집 상태를 격리한다 */
type WorkTabSource = "default" | "excel";

interface WorkTab {
    id: string;
    source: WorkTabSource;
    /** 탭 버튼에 표시(Default 또는 엑셀 시트명; 동명 시트는 (2) 접미) */
    label: string;
    cellValueMap: CellValueMap;
}

function createDefaultWorkTab(): WorkTab {
    return {
        id: DEFAULT_WORK_TAB_ID,
        source: "default",
        label: "Default",
        cellValueMap: buildCellValueMapFromInitialValues(CONFIG),
    };
}

/**
 * 엑셀에서 추출된 시트 목록으로 워크 탭 배열을 만든다.
 * - 각 탭에 `mergeExtractedWithInitialFallback` 적용
 * - 동일 시트명이 여러 번 나오면 라벨에 (2), (3)… 부여
 */
function buildWorkTabsFromValidSheets(
    listed: { sheetName: string; extracted: CellValueMap }[],
    cfg: BusinessAreaCellMapConfig,
): WorkTab[] {
    const seen = new Map<string, number>();
    return listed.map((row) => {
        const merged = mergeExtractedWithInitialFallback(row.extracted, cfg);
        const count = (seen.get(row.sheetName) ?? 0) + 1;
        seen.set(row.sheetName, count);
        const label = count === 1 ? row.sheetName : `${row.sheetName} (${count})`;
        return {
            id: crypto.randomUUID(),
            source: "excel" as const,
            label,
            cellValueMap: merged,
        };
    });
}

/** 다운로드 파일명에 쓸 문자열(Windows 금지 문자 등 제거) */
function sanitizeDownloadSegment(label: string): string {
    const cleaned = label.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
    return cleaned.length > 0 ? cleaned : "sheet";
}

/**
 * iframe `srcDoc`에 넣을 **완전한 HTML 문서** 문자열을 만든다.
 *
 * 배경:
 * - 기존에는 공통 헤드(링크·스타일)와 본문 조각을 이어 붙인 «문서 조각»만 넣었고, 브라우저가 암시적으로 `<html>`·`<body>`를 만들었다.
 * - 그 경우 `<html>` 루트에 커스텀 속성을 줄 수 없어서, 여기서는 DOCTYPE + 루트 `<html>` + `<head>` / `<body>` 로 명시한다.
 *
 * 동작:
 * - `locale` 의 `lang`·`country` 는 `locale-map.json` 기준(속성 값은 `escapeHtml` 로 이스케이프).
 * - 헤드 조각은 `<head>` 안에, 본문 조각은 `<body>` 안에 둔다.
 * - `lgUrlLocaleKey` 기준으로 **공통 헤드**의 `href` 만 `www.lg.com/global/` → `www.lg.com/{키}/` 치환(본문은 `generatedBodyHtml` 단계에서 이미 치환).
 * - LG DAM 경로 치환(`rewriteLgDamPathsForPreview`)은 헤드·본문 각각에 적용한다(미리보기 전용).
 *
 * @param commonHeadHtml 공통 헤드 조각(주로 `<link>`, `<style>`). 비어 있으면 빈 `<head>`.
 * @param bodyHtml 치환된 mapped 본문 조각(LG URL 로케일은 상위 `useMemo`에서 반영됨).
 * @param locale 미리보기 `<html lang>`·`data-countrycode`
 * @param lgUrlLocaleKey `resolveLocaleMapKeyForWorkTab` 결과 — LG 사이트 URL 경로 세그먼트
 * @returns `srcDoc`에 그대로 넣을 문자열. 둘 다 비어 있으면 `""`.
 */
function buildPreviewSrcDoc(
    commonHeadHtml: string,
    bodyHtml: string,
    locale: { lang: string; country: string },
    lgUrlLocaleKey: string,
): string {
    /** iframe 내부 `document.documentElement.getAttribute("data-biz-type")` 로 읽을 수 있는 값 */
    const dataBizType = "B2B";

    const head = commonHeadHtml.trim();
    const body = bodyHtml ?? "";

    if (!head && !body) {
        return "";
    }

    /** 헤드 조각은 `generatedBodyHtml` 파이프라인을 거치지 않으므로, 미리보기에서만 LG URL 로케일 치환 */
    const headForDam = head ? rewriteLgComGlobalPathToLocale(head, lgUrlLocaleKey) : "";
    const headRewritten = headForDam ? rewriteLgDamPathsForPreview(headForDam) : "";
    const bodyRewritten = body ? rewriteLgDamPathsForPreview(body) : "";

    const langAttr = escapeHtml(locale.lang);
    const countryAttr = escapeHtml(locale.country);
    const bizAttr = escapeHtml(dataBizType);

    return `<!DOCTYPE html>
<html lang="${langAttr}" data-countrycode="${countryAttr}" data-biz-type="${bizAttr}">
<head>
${headRewritten}
</head>
<body>
${bodyRewritten}
</body>
</html>`;
}

/**
 * 우측「셀 값 편집」상단 솔루션 탭에 표시할 문구.
 * - 카피덱에서 각 솔루션 열(`section.column`)의 **탭명 행**(`excel.mainRows.tabName`, 기본 4행) 셀 값을 우선 사용한다.
 * - 해당 셀이 비어 있으면 JSON의 `section.label`로 폴백한다(초기 로드·부분 삭제 대비).
 */
function getEditorSectionTabLabel(
    section: BusinessAreaSectionConfig,
    cellMap: CellValueMap,
    cfg: BusinessAreaCellMapConfig,
): string {
    const row = cfg.excel?.mainRows?.tabName ?? 4;
    const col = String(section.column).replace(/\$/g, "").toUpperCase();
    const addr = `${col}${row}`;
    const live = (cellMap[addr] ?? "").trim();
    return live.length > 0 ? live : section.label;
}

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
    /** 시트/기본값별 편집·미리보기 단위(기본은 Default 탭 1개) */
    const [workTabs, setWorkTabs] = useState<WorkTab[]>(() => [createDefaultWorkTab()]);
    /** 현재 보고 편집 중인 워크 탭 */
    const [activeWorkTabId, setActiveWorkTabId] = useState<string>(DEFAULT_WORK_TAB_ID);
    /** `activeWorkTabId` 최신값 — 탭 삭제 시 이웃 탭으로 포커스 이동에 사용 */
    const activeWorkTabIdRef = useRef(activeWorkTabId);
    activeWorkTabIdRef.current = activeWorkTabId;
    /** 엑셀 처리 등 사용자 알림 */
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    /** 좌측 패널(워크 탭 + HTML 도구줄 + 코드/미리보기) 래퍼. 전체화면 API는 이 루트에 요청해 탭까지 함께 표시한다 */
    const previewHostRef = useRef<HTMLDivElement>(null);
    /** document.fullscreenElement가 preview 래퍼인지 여부(툴바 라벨·레이아웃용) */
    const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
    /** 좌측 탭: 소스 코드 vs iframe 미리보기 */
    const [leftTab, setLeftTab] = useState<LeftTab>("preview");
    /** 미리보기 iframe 가로 폭: PC는 패널 전체, 모바일은 고정 폭(약 376px)으로 시뮬레이션 */
    const [previewViewport, setPreviewViewport] = useState<"pc" | "mobile">("pc");
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

    /** 활성 워크 탭(없으면 첫 탭) — 좌측 HTML·우측 필드가 이 탭의 `cellValueMap`을 쓴다 */
    const activeWorkTab = useMemo(
        () => workTabs.find((t) => t.id === activeWorkTabId) ?? workTabs[0],
        [workTabs, activeWorkTabId],
    );
    const cellValueMap = activeWorkTab?.cellValueMap ?? {};

    /** 비동기 갱신 등으로 활성 ID가 목록에 없을 때 첫 탭으로 복구 */
    useEffect(() => {
        if (workTabs.length === 0) {
            return;
        }
        if (!workTabs.some((t) => t.id === activeWorkTabId)) {
            setActiveWorkTabId(workTabs[0]!.id);
        }
    }, [workTabs, activeWorkTabId]);

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
     * mapped 본문만 placeholder 치환한 뒤, LG 사이트 `href` 중 `…/global/…` 만 시트 대응 로케일 경로로 바꾼 결과.
     * HTML 코드 탭·다운로드 파일에는 이 문자열만 사용한다(공통 헤드 제외).
     */
    const generatedBodyHtml = useMemo(() => {
        if (!mappedBodyTemplate) {
            return "";
        }

        const raw = generateHtmlByCellPlaceholders({
            template: mappedBodyTemplate,
            data: cellValueMap,
            multilineByCell,
        });
        const lgUrlLocaleKey = resolveLocaleMapKeyForWorkTab(activeWorkTab?.label ?? "Default");
        return rewriteLgComGlobalPathToLocale(raw, lgUrlLocaleKey);
    }, [mappedBodyTemplate, cellValueMap, multilineByCell, activeWorkTab?.label]);

    /**
     * iframe 미리보기용: `<html data-biz-type="…">` 가 있는 완전 문서 + `<head>`(공통 헤드) + `<body>`(본문).
     * **미리보기에서만** `/content/dam/...` → `https://www.lg.com/content/dam/...` 로 바꾼다.
     * (HTML 코드·다운로드 본문에는 DAM 절대 URL 치환을 적용하지 않는다. LG `global` URL 로케일 치환은 `href` 한정으로 본문·다운로드에 포함됨.)
     */
    const previewSrcDoc = useMemo(() => {
        const previewLabel = activeWorkTab?.label ?? "Default";
        const locale = getPreviewLocaleAttrsForWorkTabLabel(previewLabel);
        const lgUrlLocaleKey = resolveLocaleMapKeyForWorkTab(previewLabel);
        return buildPreviewSrcDoc(commonHeadHtml ?? "", generatedBodyHtml ?? "", locale, lgUrlLocaleKey);
    }, [commonHeadHtml, generatedBodyHtml, activeWorkTab?.label]);

    /**
     * 엑셀 파일 선택 시: 모든 시트를 스캔해 양식에 맞는 시트마다 워크 탭을 새로 만든다.
     * 유효 시트가 없으면 기존 탭(보통 Default)을 유지하고 메시지만 남긴다.
     */
    const handleExcelSelected = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) {
                event.target.value = "";
                return;
            }

            /**
             * Default만 있는 상태가 아니라 이미 엑셀에서 만든 워크 탭이 있으면,
             * 새 파일로 바꿀 때 기존 탭·편집값이 통째로 사라짐을 한 번 확인한다.
             */
            const hasExcelDerivedTabs = workTabs.some((t) => t.source === "excel");
            if (hasExcelDerivedTabs) {
                const ok = window.confirm(
                    "이미 불러온 엑셀 기준 워크 탭과 편집한 내용이 모두 제거됩니다.\n새 파일의 양식에 맞춰 탭이 처음부터 다시 만들어집니다.\n계속할까요?",
                );
                if (!ok) {
                    event.target.value = "";
                    return;
                }
            }

            event.target.value = "";

            setStatusMessage(null);

            try {
                const workbook = await parseExcel(file);
                const listed = listBusinessAreaSheetsFromWorkbook(workbook, CONFIG);
                if (listed.length === 0) {
                    setStatusMessage(
                        `「${file.name}」에서 양식에 맞는 시트를 찾지 못했습니다. 카피덱 그리드(탭명 행·매핑 셀 범위)가 있는 시트가 있는지 확인해 주세요.`,
                    );
                    return;
                }
                const newTabs = buildWorkTabsFromValidSheets(listed, CONFIG);
                setWorkTabs(newTabs);
                setActiveWorkTabId(newTabs[0]!.id);
                setStatusMessage(`「${file.name}」에서 양식에 맞는 시트 ${listed.length}개를 불러왔습니다.`);
            } catch (e) {
                const message = e instanceof Error ? e.message : "엑셀을 읽는 중 오류가 발생했습니다.";
                setStatusMessage(message);
            }
        },
        [workTabs],
    );

    /** 우측 필드에서 특정 셀 값만 갱신 — 활성 워크 탭의 맵만 수정 */
    const handleCellChange = useCallback((cell: string, value: string) => {
        const tabId = activeWorkTabIdRef.current;
        setWorkTabs((prev) =>
            prev.map((t) =>
                t.id !== tabId
                    ? t
                    : {
                        ...t,
                        cellValueMap: {
                            ...t.cellValueMap,
                            [cell]: value,
                        },
                    },
            ),
        );
    }, []);

    /**
     * 워크 탭 실제 제거 로직(UI에서 확인 후에만 호출).
     * - 2개 이상일 때만 목록을 줄인다.
     * - 닫는 탭이 활성이면 왼쪽 이웃 탭으로 포커스를 옮긴다.
     */
    const removeWorkTab = useCallback((tabId: string) => {
        setWorkTabs((prev) => {
            if (prev.length <= 1) {
                return prev;
            }
            const idx = prev.findIndex((t) => t.id === tabId);
            if (idx === -1) {
                return prev;
            }
            const next = prev.filter((t) => t.id !== tabId);
            if (tabId === activeWorkTabIdRef.current && next.length > 0) {
                const focusIdx = Math.max(0, idx - 1);
                queueMicrotask(() => setActiveWorkTabId(next[focusIdx]!.id));
            }
            return next;
        });
    }, []);

    /**
     * 워크 탭 닫기: 사용자에게 한 번 확인한 뒤에만 `removeWorkTab`을 실행한다.
     * (React state 업데이트 안에서 `confirm`을 호출하지 않아 Strict Mode 이중 실행 시에도 중복 확인을 피한다.)
     */
    const confirmRemoveWorkTab = useCallback(
        (tab: WorkTab) => {
            if (
                !window.confirm(
                    `「${tab.label}」워크 탭을 닫을까요?\n이 탭에서 편집한 내용은 복구할 수 없습니다.`,
                )
            ) {
                return;
            }
            removeWorkTab(tab.id);
        },
        [removeWorkTab],
    );

    const handleDownload = useCallback(() => {
        if (!generatedBodyHtml) {
            setStatusMessage("다운로드할 HTML이 없습니다. 템플릿 로딩을 확인해 주세요.");
            return;
        }

        const tab = activeWorkTab;
        const fileName =
            tab?.source === "excel"
                ? `business-area-${sanitizeDownloadSegment(tab.label)}.generated.html`
                : "business-area.generated.html";

        downloadHtml({
            html: generatedBodyHtml,
            fileName,
        });
    }, [generatedBodyHtml, activeWorkTab]);

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

    const isReady =
        commonHeadHtml !== null && mappedBodyTemplate !== null && templateError === null;

    return (
        <main className="mx-auto flex min-h-0 w-full max-w-[2000px] flex-1 flex-col gap-2 overflow-hidden p-4 md:gap-3 md:p-6">
            <header className="shrink-0 border-b border-zinc-200 pb-3 md:pb-4">
                <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
                    Why LG 번역 적용 툴
                </h1>
                <p className="mt-1 text-sm text-zinc-600">
                    지정 포맷의 .xlsx를 업로드하면 <strong>모든 시트</strong>를 검사해, 카피덱 양식에 맞는 시트마다 위쪽「워크 탭」이 생깁니다. 각 탭마다 HTML·편집 값이 따로 유지됩니다.
                    <br />
                    양식에 맞지 않는 시트는 건너뛰며, 맞는 시트가 하나도 없으면 기존 탭을 유지합니다.
                </p>
            </header>

            {/* 템플릿·업로드 한 줄: 좌측 업로드+상태, 우측 템플릿 */}
            <div
                className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-sm shadow-sm md:gap-x-3 md:px-3 md:py-2"
                role="region"
                aria-label="엑셀 템플릿 및 업로드"
            >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white shadow hover:bg-zinc-800 md:px-3 md:text-sm">
                        <span>엑셀 업로드</span>
                        <input
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            className="sr-only"
                            onChange={handleExcelSelected}
                        />
                    </label>
                    {statusMessage ? (
                        <p
                            className="min-w-0 flex-1 truncate text-xs text-zinc-700 md:text-sm"
                            role="status"
                            title={statusMessage}
                        >
                            {statusMessage}
                        </p>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span
                        className="hidden max-w-[14rem] truncate text-xs text-zinc-500 lg:inline"
                        title="카피덱 샘플을 받아 시트를 채운 뒤 업로드하세요."
                    >
                        샘플 받기 → 시트 작성 → 업로드
                    </span>
                    <a
                        href={EXAMPLE_XLSX_PUBLIC_PATH}
                        download={EXAMPLE_XLSX_DOWNLOAD_NAME}
                        className="inline-flex shrink-0 items-center rounded-md border border-zinc-400 bg-white px-2 py-1 text-xs font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 md:px-2.5 md:text-sm"
                        title="카피덱 샘플(business_area_template.xlsx). 시트를 채운 뒤 엑셀 업로드에 사용하세요. 여러 시트에 동일 그리드가 있으면 워크 탭이 여러 개 생깁니다."
                    >
                        템플릿 .xlsx
                    </a>
                </div>
            </div>

            {templateError ? (
                <p className="shrink-0 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    템플릿 로드 오류: {templateError}
                </p>
            ) : null}

            {!isReady && !templateError ? (
                <p className="shrink-0 text-sm text-zinc-600">템플릿 HTML을 불러오는 중입니다…</p>
            ) : null}

            {/* 남은 뷰포트 높이 전부 사용 — lg 이상에서 한 행·1fr로 좌우 동일 높이 */}
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:grid-rows-[minmax(0,1fr)]">
                {/* 좌측: 워크 탭 + HTML 툴바 + 본문을 하나의 패널로 — 전체화면 시에도 워크 탭이 보이도록 루트에 ref */}
                <div
                    ref={previewHostRef}
                    className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm [&:fullscreen]:h-screen [&:fullscreen]:max-h-screen [&:fullscreen]:min-h-0 [&:fullscreen]:w-full [&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:fullscreen]:shadow-none"
                >
                    {/* 크롬 스타일 워크 탭 스트립 — 전체화면 시 종료 버튼은 이 줄 우측 끝 */}
                    <div aria-label="워크 탭: 시트 또는 기본값 단위">
                        <h2 className="sr-only">워크 탭</h2>
                        <div className="flex min-h-[42px] flex-wrap items-center justify-between gap-2 bg-[#dee1e6] px-2 pb-0 pt-2">
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-px gap-y-1">
                                {workTabs.map((tab) => {
                                    const selected = tab.id === activeWorkTabId;
                                    return (
                                        <div
                                            key={tab.id}
                                            className={
                                                selected
                                                    ? "group/tab relative z-10 -mb-px flex h-10 min-h-10 w-max min-w-[7.5rem] max-w-[min(14rem,28vw)] shrink-0 items-center rounded-t-[10px] border border-zinc-300 border-b-white bg-white text-zinc-900 shadow-[0_-1px_2px_rgba(0,0,0,0.04)]"
                                                    : "group/tab relative z-0 -mb-px flex h-10 min-h-10 w-max min-w-[7.5rem] max-w-[min(14rem,28vw)] shrink-0 items-center rounded-t-[10px] border border-transparent bg-[#e8eaed] text-zinc-600 hover:bg-[#eceef2] hover:text-zinc-800"
                                            }
                                        >
                                            <button
                                                type="button"
                                                className="flex min-h-0 min-w-0 flex-1 items-center truncate px-3 py-0 text-left text-sm font-medium leading-normal"
                                                onClick={() => setActiveWorkTabId(tab.id)}
                                                aria-current={selected ? "true" : undefined}
                                            >
                                                {tab.label}
                                            </button>
                                            {workTabs.length > 1 ? (
                                                <button
                                                    type="button"
                                                    className={`flex h-10 w-8 shrink-0 items-center justify-center rounded-sm text-base leading-none text-zinc-500 transition-all duration-150 hover:bg-zinc-200/80 hover:text-zinc-800 ${
                                                        selected
                                                            ? "opacity-70 hover:opacity-100"
                                                            : "opacity-0 group-hover/tab:opacity-70 hover:opacity-100"
                                                    }`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        confirmRemoveWorkTab(tab);
                                                    }}
                                                    aria-label={`${tab.label} 탭 닫기`}
                                                    title="탭 닫기"
                                                >
                                                    ×
                                                </button>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                            {isPreviewFullscreen ? (
                                <button
                                    type="button"
                                    className="shrink-0 self-baseline rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                                    onClick={() => void exitPreviewFullscreen()}
                                    title="ESC로도 종료할 수 있습니다."
                                    aria-label="전체화면 종료"
                                >
                                    전체화면 종료
                                </button>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 py-2 md:py-2.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                            {/* 미리보기일 때만: PC 전체 너비 vs 모바일(376px) 좁은 뷰 — 아이콘+짧은 라벨로 구분 */}
                            {leftTab === "preview" ? (
                                <div
                                    className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-100 p-0.5"
                                    role="group"
                                    aria-label="미리보기 화면 너비"
                                >
                                    <button
                                        type="button"
                                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium md:text-sm ${
                                            previewViewport === "pc"
                                                ? "bg-white text-zinc-900 shadow-sm"
                                                : "text-zinc-600 hover:bg-zinc-200/80 hover:text-zinc-900"
                                        }`}
                                        onClick={() => setPreviewViewport("pc")}
                                        aria-pressed={previewViewport === "pc"}
                                        title="PC 뷰: 패널 전체 너비로 미리보기"
                                        aria-label="PC 뷰로 보기"
                                    >
                                        {/* 데스크톱 모니터 형태 — currentColor로 테마에 맞춤 */}
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="shrink-0"
                                            aria-hidden
                                        >
                                            <rect x="2" y="3" width="20" height="14" rx="2" />
                                            <path d="M8 21h8" />
                                            <path d="M12 17v4" />
                                        </svg>
                                        <span className="hidden sm:inline">PC</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium md:text-sm ${
                                            previewViewport === "mobile"
                                                ? "bg-white text-zinc-900 shadow-sm"
                                                : "text-zinc-600 hover:bg-zinc-200/80 hover:text-zinc-900"
                                        }`}
                                        onClick={() => setPreviewViewport("mobile")}
                                        aria-pressed={previewViewport === "mobile"}
                                        title="모바일 뷰: 미리보기 영역 너비 약 376px"
                                        aria-label="모바일 뷰로 보기"
                                    >
                                        {/* 스마트폰 실루엣 */}
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="shrink-0"
                                            aria-hidden
                                        >
                                            <rect x="5" y="2" width="14" height="20" rx="2" />
                                            <path d="M12 18h.01" />
                                        </svg>
                                        <span className="hidden sm:inline">모바일</span>
                                    </button>
                                </div>
                            ) : null}
                            {/* HTML 다운로드: 소스 탭에서만 표시(상단 한 줄 뷰 확보를 위해 이쪽으로 이동) */}
                            {leftTab === "code" ? (
                                <button
                                    type="button"
                                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={handleDownload}
                                    disabled={!isReady || !generatedBodyHtml}
                                >
                                    HTML 다운로드
                                </button>
                            ) : null}
                        </div>
                        {leftTab === "preview" && !isPreviewFullscreen ? (
                            <button
                                type="button"
                                className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => void enterPreviewFullscreen()}
                                disabled={!previewSrcDoc}
                                title="워크 탭·도구줄·미리보기까지 전체 화면으로 확대합니다. ESC로도 종료할 수 있습니다."
                                aria-label="HTML 패널 전체화면으로 보기"
                            >
                                전체화면
                            </button>
                        ) : null}
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col bg-white p-3">
                        {leftTab === "code" ? (
                            <textarea
                                readOnly
                                value={generatedBodyHtml}
                                spellCheck={false}
                                className="min-h-0 w-full flex-1 resize-y rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-900"
                                aria-label="생성된 HTML 소스"
                            />
                        ) : (
                            <div className="relative flex min-h-0 w-full flex-1 flex-col rounded-md border border-zinc-200 bg-zinc-50 p-2">
                                {/* PC: 한 줄 flex로 iframe이 남은 높이 전부 사용. 모바일: 가로 스크롤 허용 + 중앙에 376px 래퍼 */}
                                <div
                                    className={
                                        previewViewport === "mobile"
                                            ? "flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-x-auto overflow-y-hidden"
                                            : "flex min-h-0 min-w-0 flex-1 flex-col"
                                    }
                                >
                                    <div
                                        className={
                                            previewViewport === "mobile"
                                                ? /* flex-1: 세로 flex 체인에서 남은 높이를 iframe까지 전달 */
                                                  "flex min-h-0 w-[376px] max-w-full flex-1 shrink-0 flex-col rounded-lg border border-zinc-300 bg-white shadow-md"
                                                : "flex min-h-0 min-w-0 flex-1 flex-col"
                                        }
                                    >
                                        <iframe
                                            ref={previewIframeRef}
                                            title="HTML 미리보기"
                                            className="min-h-0 w-full flex-1 rounded-md border border-zinc-200 bg-white"
                                            // 조각 HTML이므로 외부 CSS 링크 등이 동작하도록 sandbox는 걸지 않는다(MVP).
                                            srcDoc={previewSrcDoc}
                                            onLoad={handlePreviewIframeLoad}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* 우측: JSON 기반 편집 패널 — 그리드 stretch로 좌측과 동일 높이, 내부만 세로 스크롤 */}
                <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                    <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto p-4">
                    <h2 className="mb-3 shrink-0 text-sm font-semibold text-zinc-800">셀 값 편집</h2>
                    {/* 솔루션별 필드: 상단 탭으로 섹션 전환 — 선택 시 좌측 미리보기의 동일 솔루션 탭도 활성화된다. */}
                    <div
                        className="mb-4 flex shrink-0 flex-wrap gap-1 border-b border-zinc-200 pb-3"
                        role="tablist"
                        aria-label="Business Area 솔루션별 편집 탭"
                    >
                        {CONFIG.sections.map((section) => {
                            const selected = section.key === activeSectionKey;
                            const tabLabel = getEditorSectionTabLabel(section, cellValueMap, CONFIG);
                            return (
                                <button
                                    key={section.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    title={section.label}
                                    className={`max-w-[10rem] truncate rounded-md px-2.5 py-1.5 text-xs font-medium md:max-w-[12rem] md:text-sm ${
                                        selected
                                            ? "bg-zinc-900 text-white"
                                            : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
                                    }`}
                                    onClick={() => selectEditorSection(section.key)}
                                >
                                    {tabLabel}
                                </button>
                            );
                        })}
                    </div>

                    {activeSection ? (
                        <div
                            role="tabpanel"
                            className="min-h-0 flex-1"
                            aria-label={`${getEditorSectionTabLabel(activeSection, cellValueMap, CONFIG)} 필드`}
                        >
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
                    </div>
                </aside>
            </div>
        </main>
    );
}
