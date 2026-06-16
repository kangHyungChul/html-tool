import type { QaConfig } from "./qaConfig.types";

/** QA 단일 항목 공통 상태 */
export type QaItemStatus = "pass" | "fail" | "skip" | "warn";

/** 번역(엑셀 텍스트 ↔ DOM) 검증 한 건 */
export interface TranslationCheckResult {
    status: QaItemStatus;
    cell: string;
    label: string;
    expected: string;
    /** 실패 시 해당 셀 DOM 위치에서 읽은 실제 페이지 텍스트 */
    actual?: string;
    /** 실패 시 DOM에서 찾지 못한 이유 요약 */
    detail?: string;
}

/** 링크 href 로케일/global 규칙 검증 한 건 */
export interface LinkLocaleRuleResult {
    status: QaItemStatus;
    href: string;
    linkText: string;
    targetBlank: boolean;
    /** 기대 경로 종류: locale 치환 대상이면 locale, 새창이면 global */
    expectedPathKind: "locale" | "global" | "other";
    detail?: string;
}

/** 링크 클릭·HTTP·404 검증 한 건 */
export interface LinkNavigationResult {
    status: QaItemStatus;
    href: string;
    linkText: string;
    targetBlank: boolean;
    httpStatus?: number;
    /** 새창 클릭 검증 시 실제로 popup 이 열렸는지 */
    openedNewTab?: boolean;
    detail?: string;
}

/** QA 실행 입력 */
export interface BusinessAreaQaInput {
    /** 비교군(글로벌) 페이지 URL */
    baselineUrl: string;
    /** 검증 대상(로케일) 페이지 URL */
    targetUrl: string;
    /** locale-map 키 (예: uk, global, ca_en) — 엑셀 시트명·URL 경로 검증에 사용 */
    localeKey: string;
    /** 글로벌 엑셀 파일 버퍼 */
    baselineXlsxBuffer: Buffer;
    /** 로케일 엑셀 파일 버퍼 */
    targetXlsxBuffer: Buffer;
}

/** QA 진행 단계 */
export type QaProgressPhase =
    | "excel"
    | "browser"
    | "baseline-load"
    | "baseline-locate"
    | "page-load"
    | "business-area"
    | "translation"
    | "link-extract"
    | "link-locale"
    | "link-navigation"
    | "done";

/** UI·스트림 API 진행 이벤트 */
export interface QaProgressEvent {
    phase: QaProgressPhase;
    message: string;
    /** 0~100 대략적 진행률 */
    percent: number;
    current?: number;
    total?: number;
}

/** baseline-locate 단계 완료 시 스트림으로 전송 — global 텍스트 → DOM 위치 매핑表 */
export interface BaselineMappingRow {
    cell: string;
    label: string;
    baselineText: string;
    status: "mapped" | "unresolved" | "skipped";
    source?: "baseline-dom";
    /** aria-label / alt / innerText 중 어디서 읽는지 */
    readFrom?: "text" | "aria-label" | "alt";
    relativeSelector?: string;
    reason?: string;
}

export interface BaselineMappingPhaseResult {
    phase: "baseline-locate";
    rows: BaselineMappingRow[];
    summary: { mapped: number; unresolved: number; skipped: number };
}

export interface TranslationPhaseResult {
    phase: "translation";
    results: TranslationCheckResult[];
    summary: { pass: number; fail: number; skip: number };
}

export interface LinkLocalePhaseResult {
    phase: "link-locale";
    results: LinkLocaleRuleResult[];
    summary: { pass: number; fail: number; skip: number };
}

export interface LinkNavigationPhaseResult {
    phase: "link-navigation";
    results: LinkNavigationResult[];
    summary: { pass: number; fail: number; skip: number };
}

/** 단계 완료 직후 UI에 표시할 중간 결과 */
export type QaPhaseResult =
    | BaselineMappingPhaseResult
    | TranslationPhaseResult
    | LinkLocalePhaseResult
    | LinkNavigationPhaseResult;

/** runBusinessAreaQa 옵션 — 진행 콜백·중단 signal·설정 */
export interface BusinessAreaQaRunOptions {
    /** 미지정 시 `qa/qa.config.ts` */
    config?: QaConfig;
    onProgress?: (event: QaProgressEvent) => void;
    /** baseline 매핑·번역·링크 검증 등 단계 완료 시 즉시 전송 */
    onPhaseResult?: (result: QaPhaseResult) => void;
    signal?: AbortSignal;
}

/** QA 실행 결과 전체 */
export interface BusinessAreaQaReport {
    generatedAt: string;
    input: {
        baselineUrl: string;
        targetUrl: string;
        localeKey: string;
        baselineSheetName: string;
        targetSheetName: string;
    };
    summary: {
        translation: { pass: number; fail: number; skip: number };
        linkLocaleRule: { pass: number; fail: number; skip: number };
        linkNavigation: { pass: number; fail: number; skip: number };
        overallPass: boolean;
    };
    translations: TranslationCheckResult[];
    linkLocaleRules: LinkLocaleRuleResult[];
    linkNavigation: LinkNavigationResult[];
}
